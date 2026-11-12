begin;
alter table public.amenity_services
  add column if not exists kids_rate numeric(12,2);
do $migration$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.amenity_services'::regclass
      and conname = 'amenity_kids_rate_valid'
  ) then
    alter table public.amenity_services add constraint amenity_kids_rate_valid
      check (kids_rate is null or (kids_rate >= 0 and rate_unit = 'per person'));
  end if;
end;
$migration$;
alter table public.service_transactions
  add column if not exists adult_quantity integer,
  add column if not exists kids_quantity integer,
  add column if not exists kids_rate_snapshot numeric(12,2);
create or replace function public.prepare_service_transaction()
returns trigger language plpgsql security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  svc public.amenity_services%rowtype;
  prop public.properties%rowtype;
  booking_minutes numeric;
  billed_amount numeric(12,2);
begin
  -- Balance receipts use check_service_balance_payment() instead.
  if new.balance_of is not null or auth.uid() is null then
    return new;
  end if;

  -- Serializes price changes and new bookings for this amenity.
  select * into svc from public.amenity_services
  where id = new.service_id for update;
  if not found then raise exception 'Service not found.'; end if;
  if not svc.is_active then raise exception '% is not active.', svc.name; end if;

  if new.unit_rate is not null and new.unit_rate <> svc.rate then
    raise exception using errcode = '40001',
      message = 'Service rate changed. Refresh and review the new bill before confirming payment.';
  end if;
  if new.rate_unit_snapshot is not null and new.rate_unit_snapshot <> svc.rate_unit then
    raise exception using errcode = '40001',
      message = 'Service billing unit changed. Refresh and review the new bill before confirming payment.';
  end if;

  if new.property_id is null then raise exception 'Select a homeowner.'; end if;
  select * into prop from public.properties where id = new.property_id for update;
  if not found then raise exception 'Homeowner not found.'; end if;
  if prop.homeowner_status is distinct from 'active' then
    raise exception using errcode = '22023',
      message = 'New service receipts require an active homeowner account. Refresh and select the current owner.';
  end if;

  if svc.rate_unit = 'per person' and svc.kids_rate is not null then
    if new.adult_quantity is null or new.kids_quantity is null or new.adult_quantity < 0 or new.kids_quantity < 0 or new.adult_quantity + new.kids_quantity < 1 then
      raise exception 'Enter adult and kids counts, with at least one visitor.';
    end if;
    if new.kids_rate_snapshot is distinct from svc.kids_rate then
      raise exception using errcode='40001', message='Kids rate changed. Refresh before confirming payment.';
    end if;
    new.quantity := new.adult_quantity + new.kids_quantity;
    billed_amount := round(svc.rate * new.adult_quantity + svc.kids_rate * new.kids_quantity, 2);
  elsif svc.rate_unit = 'per hour' then
    if new.start_time is null or new.end_time is null or new.end_time <= new.start_time then
      raise exception using errcode = '22023', message = 'Select a valid reservation start and end time.';
    end if;
    booking_minutes := extract(epoch from (new.end_time - new.start_time))::numeric / 60;
    new.quantity := round(booking_minutes / 60, 4);
    billed_amount := round(svc.rate * booking_minutes / 60, 2);
  else
    if new.quantity is null or new.quantity < 1 or new.quantity <> trunc(new.quantity) then
      raise exception using errcode = '22023',
        message = 'Countable service quantities must be positive whole numbers.';
    end if;
    billed_amount := round(svc.rate * new.quantity, 2);
  end if;

  if not (svc.rate_unit = 'per person' and svc.kids_rate is not null) then
    if new.adult_quantity is not null or new.kids_quantity is not null or new.kids_rate_snapshot is not null then
      raise exception 'Tiered counts are only valid for a tiered per-person service.';
    end if;
  end if;
  if billed_amount <= 0 then raise exception 'Service has no positive billable amount.'; end if;
  if new.amount_due is not null and new.amount_due <> billed_amount then
    raise exception using errcode = '40001',
      message = 'Service price or billable duration changed. Refresh and review the bill.';
  end if;

  new.unit_rate := svc.rate;
  new.rate_unit_snapshot := svc.rate_unit;
  new.amount_due := billed_amount;
  new.service_name := svc.name;
  new.customer_name := coalesce(nullif(btrim(prop.homeowner_name), ''), new.customer_name);
  new.block_name := prop.block;
  new.lot_number := prop.lot_number::text;

  if new.amount_paid is null or new.amount_paid <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if new.amount_paid > new.amount_due then
    raise exception 'Amount received exceeds amount due of PHP %. Return the extra as change.', new.amount_due;
  end if;

  new.payment_status := case when new.amount_paid >= new.amount_due then 'paid' else 'partial' end;
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  return new;
end;
$fn$;

revoke execute on function public.prepare_service_transaction()
from public, anon, authenticated;

-- Refresh the API column cache after this transaction commits.
notify pgrst, 'reload schema';
commit;
