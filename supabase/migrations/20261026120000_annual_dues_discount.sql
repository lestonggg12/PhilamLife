create or replace function public.prepare_payment_record()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
begin
  if new.paid_at is null then
    new.paid_at := now();
  end if;

  if new.created_at is null then
    new.created_at := now();
  end if;

  if auth.uid() is not null then
    new.status := 'Completed';
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.effect_released := 0;
  end if;

  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number :=
      'OR-' ||
      to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') ||
      '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);

  if paid is null or paid <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  new.amount_paid := paid;

  ct := coalesce(new.charge_type, 'Association Dues');

  if ct not in (
    'Association Dues',
    'Special Assessment',
    'Penalty / Late Fee',
    'Sticker / ID Fee',
    'Document / Certification Fee',
    'Other'
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

    select monthly_dues
      into monthly_due
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
    -- Post any yearly penalty that has fallen due before reading the balance.
    perform public.post_due_penalties(new.property_id);

    select current_balance
      into bal
    from public.properties
    where id = new.property_id
    for update;

    if not found then
      raise exception 'Property not found.';
    end if;

    if annual_meta is not null and bal > 0.005 then
      raise exception 'Clear the outstanding balance before applying the annual dues discount.';
    end if;

    if ct = 'Other' then
      select coalesce(sum(amount), 0)
        into charged
      from public.property_charges
      where property_id = new.property_id
        and charge_type = ct
        and voided_at is null;

      select coalesce(sum(balance_effect - effect_released), 0)
        into applied
      from public.payments
      where property_id = new.property_id
        and charge_type = ct
        and status <> 'Voided';

      effect := least(paid, greatest(charged - applied, 0));
    elsif annual_meta is not null then
      -- Record the discounted cash payment, but credit the full annual dues.
      effect := round(new.amount, 2);
    else
      -- Existing Association Dues and typed-fee behavior remains unchanged.
      effect := paid;
    end if;

    receipt_snapshot := coalesce(
      public.receipt_breakdown_for(new.property_id),
      '{}'::jsonb
    );

    -- Preserve the discount metadata alongside the existing receipt snapshot.
    if annual_meta is not null then
      new.receipt_breakdown :=
        receipt_snapshot ||
        jsonb_build_object('annual_advance_discount', annual_meta);
    else
      new.receipt_breakdown := receipt_snapshot;
    end if;

    new.previous_balance := bal;
    new.balance_effect := effect;
    new.remaining_balance := bal - effect;

    update public.properties
    set current_balance = new.remaining_balance
    where id = new.property_id;
  else
    new.balance_effect := 0;
    new.remaining_balance := coalesce(new.previous_balance, 0) - paid;
  end if;

  return new;
end;
$function$;