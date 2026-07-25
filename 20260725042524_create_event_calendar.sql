begin;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (length(btrim(title)) between 1 and 160),
  description text
    check (
      description is null
      or length(btrim(description)) between 1 and 1000
    ),
  event_date date not null,
  start_time time without time zone,
  end_time time without time zone,
  location text
    check (
      location is null
      or length(btrim(location)) between 1 and 160
    ),
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_by_name text not null
    check (length(btrim(created_by_name)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_range_check
    check (
      end_time is null
      or (start_time is not null and end_time > start_time)
    )
);

comment on table public.events is
  'Persistent community meetings and events scheduled in Manila local time.';
comment on column public.events.event_date is
  'Calendar date interpreted in Asia/Manila.';
comment on column public.events.start_time is
  'Optional local start time interpreted in Asia/Manila.';
comment on column public.events.end_time is
  'Optional local end time interpreted in Asia/Manila.';

create index events_event_date_start_time_idx
  on public.events (event_date, start_time);

alter table public.events enable row level security;

revoke all on table public.events from anon;
revoke all on table public.events from authenticated;
grant select, insert, delete on table public.events to authenticated;
grant update (
  title,
  description,
  event_date,
  start_time,
  end_time,
  location,
  updated_at
) on table public.events to authenticated;

create policy "Secretary can view events"
on public.events
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and lower(profiles.role) = 'secretary'
      and profiles.is_active = true
  )
);

create policy "Secretary can schedule events"
on public.events
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and lower(profiles.role) = 'secretary'
      and profiles.is_active = true
  )
);

create policy "Secretary can update events"
on public.events
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and lower(profiles.role) = 'secretary'
      and profiles.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and lower(profiles.role) = 'secretary'
      and profiles.is_active = true
  )
);

create policy "Secretary can delete events"
on public.events
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and lower(profiles.role) = 'secretary'
      and profiles.is_active = true
  )
);

commit;
