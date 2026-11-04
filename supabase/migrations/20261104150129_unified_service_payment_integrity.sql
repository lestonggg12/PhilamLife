-- Frontend and SQL must be released together. Existing receipt values are unchanged.
alter table public.service_transactions
  alter column quantity type numeric(12,4) using quantity::numeric(12,4);

alter table public.service_transactions
  add column if not exists submission_key uuid;
alter table public.service_transactions
  add column if not exists rate_unit_snapshot text;

create unique index if not exists service_transactions_submission_key_unique
  on public.service_transactions (submission_key)
  where submission_key is not null;

-- Legacy clients without a submission key keep the old short-window guard.
-- New clients are protected by a unique DB key for unlimited time.
create or replace function public.reject_duplicate_service_submission()
returns trigger language plpgsql set search_path = 'public', 'pg_temp'
as $fn$
declare
  uid uuid := auth.uid();
  existing text;
begin
  if new.submission_key is not null then return new; end if;
  if uid is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('dup-service:' || coalesce(new.property_id::text, '-') || ':' || coalesce(new.balance_of::text, '-') || ':' || uid::text));
  select s.receipt_number into existing from public.service_transactions s
  where s.recorded_by = uid
    and s.property_id is not distinct from new.property_id
    and s.service_id is not distinct from new.service_id
    and s.balance_of is not distinct from new.balance_of
    and s.quantity is not distinct from new.quantity
    and (new.property_id is not null or coalesce(s.customer_name, '') = coalesce(new.customer_name, ''))
    and coalesce(s.amount_paid, 0) = coalesce(new.amount_paid, 0)
    and s.payment_method is not distinct from new.payment_method
    and coalesce(btrim(s.reference_number), '') = coalesce(btrim(new.reference_number), '')
    and lower(coalesce(s.payment_status, 'paid')) <> 'voided'
    and s.paid_at > now() - interval '15 seconds'
  limit 1;
  if existing is not null then
    raise exception using errcode = '23505',
      message = format('This service payment was already recorded a moment ago (receipt %s). Check receipt history before retrying.', existing);
  end if;
  return new;
end;
$fn$;

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

  if svc.rate_unit = 'per hour' then
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
revoke execute on function public.reject_duplicate_service_submission()
from public, anon, authenticated;