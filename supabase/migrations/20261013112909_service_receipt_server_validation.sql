alter table public.service_transactions
  add column if not exists unit_rate numeric(12,2),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

comment on column public.service_transactions.unit_rate is 'Catalog rate in force when the receipt was issued; amount_due = unit_rate x quantity.';

-- Existing primary receipts: derive the rate that was actually charged.
update public.service_transactions
   set unit_rate = round(amount_due / nullif(quantity, 0), 2)
 where balance_of is null and unit_rate is null;

alter table public.service_transactions
  add constraint service_transactions_payment_status_check
  check (payment_status in ('paid', 'partial', 'voided'));

create or replace function public.prepare_service_transaction()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  svc public.amenity_services%rowtype;
  prop public.properties%rowtype;
begin
  -- Balance payments are handled by check_service_balance_payment(); server-side writes skip this.
  if new.balance_of is not null or auth.uid() is null then
    return new;
  end if;

  select * into svc from public.amenity_services where id = new.service_id;
  if not found then raise exception 'Service not found.'; end if;
  if not svc.is_active then raise exception '% is not active.', svc.name; end if;

  if new.property_id is null then raise exception 'Select a homeowner.'; end if;
  select * into prop from public.properties where id = new.property_id;
  if not found then raise exception 'Homeowner not found.'; end if;

  new.quantity := greatest(coalesce(new.quantity, 1), 1);
  new.unit_rate := svc.rate;
  new.amount_due := round(svc.rate * new.quantity, 2);
  if new.amount_due <= 0 then raise exception '% has no rate set.', svc.name; end if;

  new.service_name := svc.name;
  new.customer_name := coalesce(nullif(btrim(prop.homeowner_name), ''), new.customer_name);
  new.block_name := prop.block;
  new.lot_number := prop.lot_number::text;

  if new.amount_paid is null or new.amount_paid <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if new.amount_paid > new.amount_due then
    raise exception 'Amount received is more than the amount due of PHP %. Return the extra as change.', new.amount_due;
  end if;

  new.payment_status := case when new.amount_paid >= new.amount_due then 'paid' else 'partial' end;
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  return new;
end $$;

create trigger prepare_service_transaction_before_insert
  before insert on public.service_transactions
  for each row execute function public.prepare_service_transaction();;
