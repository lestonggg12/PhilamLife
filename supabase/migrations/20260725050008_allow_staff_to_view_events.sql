begin;

drop policy if exists "Secretary can view events" on public.events;

create policy "Active staff can view events"
on public.events
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and lower(profiles.role) in ('admin', 'treasurer', 'secretary')
      and profiles.is_active = true
  )
);

commit;