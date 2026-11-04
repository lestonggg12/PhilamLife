-- Already applied to production. For fresh database setup only.

create extension if not exists btree_gist with schema extensions;

alter table public.service_transactions
  add column if not exists booking_exclusive boolean not null default false;

update public.service_transactions st
set booking_exclusive = (
  st.balance_of is null
  and exists (
    select 1 from public.amenity_services svc
    where svc.id = st.service_id
      and lower(btrim(coalesce(svc.rate_unit, ''))) = 'per hour'
  )
)
where st.booking_exclusive is distinct from (
  st.balance_of is null
  and exists (
    select 1 from public.amenity_services svc
    where svc.id = st.service_id
      and lower(btrim(coalesce(svc.rate_unit, ''))) = 'per hour'
  )
);

create or replace function public.set_service_booking_exclusivity()
returns trigger language plpgsql security invoker set search_path = ''
as $body$
begin
  new.booking_exclusive := new.balance_of is null and exists (
    select 1 from public.amenity_services s
    where s.id = new.service_id
      and lower(btrim(coalesce(s.rate_unit, ''))) = 'per hour'
  );
  return new;
end;
$body$;

drop trigger if exists z_set_service_booking_exclusivity
on public.service_transactions;

create trigger z_set_service_booking_exclusivity
before insert or update of service_id, balance_of, booking_exclusive
on public.service_transactions
for each row execute function public.set_service_booking_exclusivity();

revoke execute on function public.set_service_booking_exclusivity()
from public, anon, authenticated;

alter table public.service_transactions
  add constraint service_booking_exclusive_valid_time
  check (
    not booking_exclusive
    or (
      start_time is not null
      and end_time is not null
      and end_time > start_time
    )
  );

alter table public.service_transactions
  add constraint service_booking_exclusive_no_overlap
  exclude using gist (
    service_id with =,
    service_date with =,
    tsrange(service_date + start_time, service_date + end_time, '[)') with &&
  )
  where (
    booking_exclusive
    and balance_of is null
    and payment_status <> 'voided'
  );