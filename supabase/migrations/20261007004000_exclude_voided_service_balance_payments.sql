-- Voided balance-payment receipts must not reduce a parent's outstanding
-- service balance or permit a later payment to be rejected incorrectly.
create or replace function public.check_service_balance_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  parent public.service_transactions%rowtype;
  collected numeric(12,2);
  remaining numeric(12,2);
begin
  if new.balance_of is null then
    return new;
  end if;

  select * into parent
  from public.service_transactions
  where id = new.balance_of
  for update;
  if not found then
    raise exception 'The receipt being settled was not found.';
  end if;
  if parent.balance_of is not null then
    raise exception 'A balance payment cannot itself be settled.';
  end if;
  if parent.payment_status <> 'partial' then
    raise exception 'Receipt % is already fully paid.', parent.receipt_number;
  end if;

  select coalesce(sum(amount_paid), 0) into collected
  from public.service_transactions
  where balance_of = parent.id
    and lower(coalesce(payment_status, 'paid')) <> 'voided';
  remaining := parent.amount_due - parent.amount_paid - collected;

  if remaining <= 0 then
    raise exception 'Receipt % has no unpaid balance left.', parent.receipt_number;
  end if;
  if new.amount_paid is null or new.amount_paid <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if new.amount_paid > remaining then
    raise exception 'Amount is more than the unpaid balance of PHP %.', remaining;
  end if;

  new.property_id := parent.property_id;
  new.service_id := parent.service_id;
  new.service_name := parent.service_name;
  new.customer_name := parent.customer_name;
  new.block_name := parent.block_name;
  new.lot_number := parent.lot_number;
  new.service_date := (now() at time zone 'Asia/Manila')::date;
  new.start_time := null;
  new.quantity := 1;
  new.amount_due := new.amount_paid;
  new.payment_status := 'paid';
  new.notes := trim(both ' ' from 'Balance payment for ' || parent.receipt_number ||
                    case when coalesce(trim(new.notes), '') = '' then '' else ' — ' || trim(new.notes) end);
  return new;
end $function$;

create or replace view public.service_balances
with (security_invoker = true) as
select
  p.id,
  p.receipt_number,
  p.service_id,
  p.service_name,
  p.customer_name,
  p.block_name,
  p.lot_number,
  p.property_id,
  p.service_date,
  p.paid_at,
  p.amount_due,
  p.amount_paid,
  coalesce(c.collected, 0)::numeric(12,2) as collected_later,
  (p.amount_due - p.amount_paid - coalesce(c.collected, 0))::numeric(12,2) as balance_due
from public.service_transactions p
left join lateral (
  select sum(x.amount_paid) as collected
  from public.service_transactions x
  where x.balance_of = p.id
    and lower(coalesce(x.payment_status, 'paid')) <> 'voided'
) c on true
where p.balance_of is null
  and lower(coalesce(p.payment_status, 'paid')) = 'partial'
  and (p.amount_due - p.amount_paid - coalesce(c.collected, 0)) > 0;
