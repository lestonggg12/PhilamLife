alter table public.properties
  add column if not exists homeowner_status text not null default 'active',
  add column if not exists status_effective_date date,
  add column if not exists status_reason text,
  add column if not exists status_updated_at timestamp with time zone;

update public.properties
set homeowner_status = 'active'
where homeowner_status is null
   or lower(homeowner_status) not in ('active', 'moved', 'transferred');

alter table public.properties
  drop constraint if exists properties_homeowner_status_check;

alter table public.properties
  add constraint properties_homeowner_status_check
  check (homeowner_status in ('active', 'moved', 'transferred'));

create index if not exists properties_homeowner_status_idx
  on public.properties (homeowner_status);

comment on column public.properties.homeowner_status is
  'Residency status. Moved and transferred homeowners remain stored so historical payments and receipts keep their property relationship.';

comment on column public.properties.status_effective_date is
  'Date the homeowner moved away or transferred the property.';

comment on column public.properties.status_reason is
  'Optional staff note explaining the move or transfer.';

comment on column public.properties.status_updated_at is
  'Most recent time the homeowner residency status was changed.';