-- Future calendar metadata and optimistic edit tokens are server-controlled.
-- Install the authoritative Activity Log migration first. No old rows are edited.
begin;
set local lock_timeout='5s';
do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass
   and tgname='audit_event_management' and tgfoid=to_regprocedure('public.audit_management_change()')
   and tgtype=29 and tgenabled in ('O','A')) then
  raise exception 'Install and verify the authoritative Activity Log migration first.';
 end if;
end$$;

create or replace function public.prepare_calendar_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'')<>'secretary' then
  raise exception using errcode='42501',message='Only an active Secretary can manage calendar events.';
 end if;
 if tg_op='INSERT' then
  new.created_by:=auth.uid();
  select left(coalesce(nullif(btrim(full_name),''),email,'Secretary'),160)
   into new.created_by_name from public.profiles where id=auth.uid();
  new.created_at:=clock_timestamp();
 else
  new.id:=old.id;new.created_by:=old.created_by;
  new.created_by_name:=old.created_by_name;new.created_at:=old.created_at;
 end if;
 new.updated_at:=clock_timestamp();
 return new;
end;
$$;
revoke all on function public.prepare_calendar_event() from public,anon,authenticated;
create or replace trigger prepare_calendar_event before insert or update on public.events
 for each row execute function public.prepare_calendar_event();

do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.events'::regclass and conname='events_supported_date') then
  alter table public.events add constraint events_supported_date
   check(isfinite(event_date) and event_date between date '0001-01-01' and date '9999-12-31');
 end if;
end$$;
notify pgrst,'reload schema';
commit;
