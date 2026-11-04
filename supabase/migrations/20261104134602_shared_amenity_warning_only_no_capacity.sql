-- Already applied to Supabase production as migration 20261104134602.
-- Do not execute manually again on that project.

alter table public.amenity_services
  drop constraint if exists amenity_shared_booking_limit_positive;

alter table public.amenity_services
  drop column if exists shared_booking_limit;

create or replace function public.enforce_shared_service_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  reviewed_count integer;
  amenity_exists boolean;
begin
  if new.balance_of is not null then
    return new;
  end if;

  -- Serialize concurrent bookings for the same amenity.
  select true into amenity_exists
  from public.amenity_services a
  where a.id = new.service_id
  for update;

  if amenity_exists is distinct from true then
    raise exception using
      errcode = '22023',
      message = 'Amenity not found.';
  end if;

  if new.start_time is null
     or new.end_time is null
     or new.end_time <= new.start_time then
    raise exception using
      errcode = '22023',
      message = 'Select a valid start and end time.';
  end if;

  select count(*) into reviewed_count
  from public.service_transactions s
  where s.service_id = new.service_id
    and s.service_date = new.service_date
    and s.balance_of is null
    and s.payment_status <> 'voided'
    and s.start_time < new.end_time
    and s.end_time > new.start_time;

  -- No maximum capacity.
  -- Require the staff member to review any updated overlap count.
  if new.overlap_acknowledged_count is distinct from reviewed_count then
    raise exception using
      errcode = '40001',
      message =
        'Booking count changed. Review current reservations before confirming payment.';
  end if;

  return new;
end;
$fn$;

revoke execute
on function public.enforce_shared_service_booking()
from public, anon, authenticated;