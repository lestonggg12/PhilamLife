-- Audit fix: prevent a typed fee payment from exceeding the unpaid active charge.
-- Positive amount checks already exist on payments, property_charges, and
-- service_transactions in the deployed database.

create or replace function public.prepare_payment_record()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  bal numeric(12,2);
  paid numeric(12,2);
  ct text;
  charged numeric(12,2);
  applied numeric(12,2);
  effect numeric(12,2);
begin
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
    new.receipt_number := 'OR-' || to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);
  if paid is null or paid <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  new.amount_paid := paid;
  ct := coalesce(new.charge_type, 'Association Dues');
  if ct not in ('Association Dues','Special Assessment','Penalty / Late Fee','Sticker / ID Fee','Document / Certification Fee','Other') then
    ct := 'Other';
  end if;
  new.charge_type := ct;

  if new.property_id is not null then
    select current_balance into bal
    from public.properties
    where id = new.property_id
    for update;
    if not found then raise exception 'Property not found.'; end if;

    if ct = 'Association Dues' then
      effect := paid;
    else
      select coalesce(sum(amount), 0) into charged
      from public.property_charges
      where property_id = new.property_id
        and charge_type = ct
        and voided_at is null;

      select coalesce(sum(balance_effect - effect_released), 0) into applied
      from public.payments
      where property_id = new.property_id
        and charge_type = ct
        and status <> 'Voided';

      if ct <> 'Other' and paid > greatest(charged - applied, 0) + 0.005 then
        raise exception
          'Amount is more than the unpaid % of PHP %. Add the charge first, or enter the exact amount due.',
          ct, to_char(greatest(charged - applied, 0), 'FM999,999,990.00');
      end if;
      effect := least(paid, greatest(charged - applied, 0));
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
$$;
