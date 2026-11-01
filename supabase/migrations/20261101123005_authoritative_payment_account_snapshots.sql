-- Future payments only. Existing receipt snapshots and account balances are not rewritten.
begin;

-- All existing payments were checked for account binding before preparing this
-- migration. If new unbound rows exist, fail atomically for explicit review.
alter table public.payments alter column property_id set not null;

CREATE OR REPLACE FUNCTION public.prepare_payment_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bal numeric(12,2);
  paid numeric(12,2);
  ct text;
  charged numeric(12,2);
  applied numeric(12,2);
  effect numeric(12,2);
  monthly_due numeric(12,2);
  annual_meta jsonb;
  receipt_snapshot jsonb;
  payment_property public.properties%rowtype;
  payment_recorder public.profiles%rowtype;
  actor uuid;
begin
  -- A receipt must bind to a real, currently active account. Hold its row lock
  -- through the payment so a concurrent transfer cannot invalidate this check.
  if new.property_id is null then
    raise exception 'Select an active homeowner account before recording a payment.' using errcode = '22023';
  end if;
  actor := coalesce(auth.uid(), new.recorded_by);
  select * into payment_recorder from public.profiles
    where id = actor and coalesce(is_active, true)
      and lower(btrim(role)) in ('admin', 'secretary', 'treasurer');
  if not found then
    raise exception 'An active staff recorder is required for this payment.' using errcode = '42501';
  end if;
  select * into payment_property from public.properties
    where id = new.property_id for update;
  if not found then
    raise exception 'The selected homeowner account could not be found.' using errcode = '23503';
  end if;
  if payment_property.homeowner_status is distinct from 'active' then
    raise exception 'Payments can only be recorded for active homeowner accounts. Refresh and select the current owner.' using errcode = '22023';
  end if;

  -- Ignore client-supplied identity snapshots; freeze authoritative values now.
  new.homeowner_name := payment_property.homeowner_name;
  new.block_name := payment_property.block;
  new.lot_number := payment_property.lot_number::text;
  new.recorded_by := payment_recorder.id;
  new.recorded_by_name := coalesce(nullif(btrim(payment_recorder.full_name), ''), payment_recorder.email, 'Staff user');

  if new.paid_at is null then new.paid_at := now(); end if;
  if new.created_at is null then new.created_at := now(); end if;

  if auth.uid() is not null then
    new.status := 'Completed';
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.effect_released := 0;
  end if;

  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number :=
      'OR-' || to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);
  if paid is null or paid <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  new.amount_paid := paid;

  ct := coalesce(new.charge_type, 'Association Dues');
  if ct not in (
    'Association Dues', 'Balance Payment', 'Special Assessment',
    'Penalty / Late Fee', 'Sticker / ID Fee',
    'Document / Certification Fee', 'Other'
  ) then
    ct := 'Other';
  end if;
  new.charge_type := ct;
  annual_meta := new.receipt_breakdown -> 'annual_advance_discount';

  if annual_meta is not null then
    if ct <> 'Association Dues' then
      raise exception 'The annual discount is only available for Association Dues.';
    end if;
    if new.property_id is null then
      raise exception 'A homeowner property is required for the annual discount.';
    end if;
    if coalesce((annual_meta ->> 'months_covered')::integer, 0) <> 12 then
      raise exception 'The annual discount must cover exactly 12 months.';
    end if;

    select monthly_dues into monthly_due
    from public.property_monthly_dues
    where property_id = new.property_id;

    if monthly_due is null or monthly_due <= 0 then
      raise exception 'Could not determine the homeowner monthly dues.';
    end if;
    if round(coalesce(new.amount, 0), 2) <> round(monthly_due * 12, 2) then
      raise exception 'The regular annual dues amount does not match the current monthly dues.';
    end if;
    if round(coalesce((annual_meta ->> 'gross_amount')::numeric, 0), 2)
       <> round(new.amount, 2) then
      raise exception 'The annual dues receipt amount does not match the regular annual dues.';
    end if;
    if round(coalesce((annual_meta ->> 'discount_amount')::numeric, 0), 2)
       <> round(monthly_due, 2) then
      raise exception 'The annual discount must equal one month of dues.';
    end if;
    if round(paid, 2) <> round(new.amount - monthly_due, 2) then
      raise exception 'The amount collected must equal annual dues minus one month free.';
    end if;
  end if;

  if new.property_id is not null then
    perform public.post_due_penalties(new.property_id);

    select current_balance into bal
    from public.properties
    where id = new.property_id
    for update;
    if not found then raise exception 'Property not found.'; end if;

    if annual_meta is not null and bal > 0.005 then
      raise exception 'Clear the outstanding balance before applying the annual dues discount.';
    end if;

    if ct = 'Other' then
      select coalesce(sum(amount), 0) into charged
      from public.property_charges
      where property_id = new.property_id and charge_type = ct and voided_at is null;
      select coalesce(sum(balance_effect - effect_released), 0) into applied
      from public.payments
      where property_id = new.property_id and charge_type = ct and status <> 'Voided';
      effect := least(paid, greatest(charged - applied, 0));
    elsif annual_meta is not null then
      effect := round(new.amount, 2);
    else
      effect := paid;
    end if;

    receipt_snapshot := coalesce(public.receipt_breakdown_for(new.property_id), '{}'::jsonb);
    if annual_meta is not null then
      new.receipt_breakdown :=
        receipt_snapshot || jsonb_build_object('annual_advance_discount', annual_meta);
    else
      new.receipt_breakdown := receipt_snapshot;
    end if;

    new.previous_balance := bal;
    new.balance_effect := effect;
    new.remaining_balance := bal - effect;
    update public.properties
    set current_balance = new.remaining_balance
    where id = new.property_id;
  end if;

  return new;
end;
$function$;

revoke all on function public.prepare_payment_record() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
