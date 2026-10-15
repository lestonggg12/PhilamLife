-- Allow the 'voided' state alongside the existing paid/partial amount rules.
alter table public.service_transactions drop constraint service_transactions_check;
alter table public.service_transactions
  add constraint service_transactions_check
  check (
    payment_status = 'voided'
    or (payment_status = 'paid' and amount_paid >= amount_due)
    or (payment_status = 'partial' and amount_paid < amount_due)
  );

create or replace function public.void_service_transaction(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.service_transactions%rowtype;
begin
  if coalesce(public.current_user_role(), '') not in ('secretary', 'treasurer') then
    raise exception 'You do not have permission to void service receipts.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'A reason is required to void a receipt (at least 5 characters).';
  end if;

  select * into r from public.service_transactions where id = p_id for update;
  if not found then raise exception 'Receipt not found.'; end if;
  if lower(coalesce(r.payment_status, 'paid')) = 'voided' then
    raise exception 'Receipt % is already voided.', r.receipt_number;
  end if;
  if r.balance_of is null and exists (
       select 1 from public.service_transactions x
        where x.balance_of = r.id and lower(coalesce(x.payment_status, 'paid')) <> 'voided') then
    raise exception 'Receipt % has balance payments. Void those first.', r.receipt_number;
  end if;

  update public.service_transactions
     set payment_status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
   where id = p_id;
end $$;

revoke execute on function public.void_service_transaction(uuid, text) from public, anon;
grant execute on function public.void_service_transaction(uuid, text) to authenticated;

-- Clearer message when someone tries to collect against a voided receipt.
create or replace function public.check_service_balance_payment()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
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
  if parent.payment_status = 'voided' then
    raise exception 'Receipt % has been voided.', parent.receipt_number;
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
end $$;;
