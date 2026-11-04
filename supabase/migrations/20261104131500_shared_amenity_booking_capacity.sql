-- Already applied to production. For fresh database setup only.
-- Must follow the original hourly-booking migration.

alter table public.amenity_services
  add column if not exists shared_booking_limit
  integer not null default 1;

alter table public.amenity_services
  add constraint amenity_shared_booking_limit_positive
  check (shared_booking_limit between 1 and 1000);

alter table public.service_transactions
  add column if not exists overlap_acknowledged_count
  integer not null default 0;

alter table public.service_transactions
  add constraint service_overlap_acknowledged_nonnegative
  check (overlap_acknowledged_count >= 0);

alter table public.service_transactions
  add constraint service_shared_booking_valid_times
  check (
    balance_of is not null
    or (
      start_time is not null
      and end_time is not null
      and end_time > start_time
    )
  );

alter table public.service_transactions
  drop constraint service_booking_exclusive_no_overlap;

create or replace function public.enforce_shared_service_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  max_allowed integer;
  overlapping_count integer;
  peak_existing integer;
begin
  if new.balance_of is not null then
    return new;
  end if;

  -- Lock amenity row so concurrent booking inserts are serialized.
  select a.shared_booking_limit
  into max_allowed
  from public.amenity_services a
  where a.id = new.service_id
  for update;

  if not found then
    raise exception 'Amenity not found.';
  end if;

  if new.start_time is null
     or new.end_time is null
     or new.end_time <= new.start_time then
    raise exception using
      errcode = '22023',
      message = 'Select a valid start and end time.';
  end if;

  -- Count reservations overlapping any part of the requested period.
  select count(*)
  into overlapping_count
  from public.service_transactions s
  where s.service_id = new.service_id
    and s.service_date = new.service_date
    and s.balance_of is null
    and s.payment_status <> 'voided'
    and s.start_time < new.end_time
    and s.end_time > new.start_time;

  -- Require a new warning if availability has changed.
  if overlapping_count <> new.overlap_acknowledged_count then
    raise exception using
      errcode = '40001',
      message =
        'Booking availability changed. Review existing reservations before confirming payment.';
  end if;

  -- Find peak occupancy, rather than summing sequential bookings.
  select coalesce(max(occupants), 0)
  into peak_existing
  from (
    select new.start_time as instant

    union

    select s.start_time
    from public.service_transactions s
    where s.service_id = new.service_id
      and s.service_date = new.service_date
      and s.balance_of is null
      and s.payment_status <> 'voided'
      and s.start_time > new.start_time
      and s.start_time < new.end_time
      and s.end_time > new.start_time
  ) moments
  cross join lateral (
    select count(*) as occupants
    from public.service_transactions s
    where s.service_id = new.service_id
      and s.service_date = new.service_date
      and s.balance_of is null
      and s.payment_status <> 'voided'
      and s.start_time <= moments.instant
      and s.end_time > moments.instant
  ) counts;

  if peak_existing + 1 > max_allowed then
    raise exception using
      errcode = '23514',
      message =
        'Amenity booking capacity reached for the selected time.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists zz_enforce_shared_service_booking
on public.service_transactions;

create trigger zz_enforce_shared_service_booking
before insert on public.service_transactions
for each row
execute function public.enforce_shared_service_booking();

revoke execute
on function public.enforce_shared_service_booking()
from public, anon, authenticated;