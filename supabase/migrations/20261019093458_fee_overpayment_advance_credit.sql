-- Policy (confirmed by the owner): any payment above what is owed becomes advance credit.
-- 1) Typed fee payments now apply in full to the balance (like Association Dues) instead of being
--    capped at, or rejected above, the unpaid charge. 'Other' payments are unchanged (no charge = no effect).
-- 2) Voiding a fee charge no longer "releases" the payments that paid it; the money stays as credit.
--    This supersedes the release logic added in 20261018093021.
-- 3) Legacy rows repaired: payments 35, 36 (2,500 vs 1,000 fee) and 801 (500 released) now carry their full amount.

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

    if ct = 'Other' then
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

      effect := least(paid, greatest(charged - applied, 0));
    else
      -- Association Dues and typed fees: the full amount reaches the balance; any excess is advance credit.
      effect := paid;
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

create or replace function public.apply_charge_to_balance()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;
  elsif old.voided_at is null and new.voided_at is not null then
    update public.properties set current_balance = current_balance - new.amount where id = new.property_id;
  elsif old.voided_at is not null and new.voided_at is null then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;
  end if;
  return new;
end;
$function$;

update public.properties pr
set current_balance = pr.current_balance - d.delta
from (
  select property_id, sum(amount_paid - (balance_effect - effect_released)) as delta
  from public.payments
  where status <> 'Voided'
    and charge_type not in ('Association Dues', 'Other')
    and amount_paid <> balance_effect - effect_released
  group by 1
) d
where pr.id = d.property_id;

update public.payments
set balance_effect = amount_paid, effect_released = 0
where status <> 'Voided'
  and charge_type not in ('Association Dues', 'Other')
  and amount_paid <> balance_effect - effect_released;