-- Future settings changes and their activity entry must commit together.
-- No existing settings, accounts or activity rows are modified at installation.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.write_required_balance_audit(text,text)') is null then
    raise exception 'Install the required activity audit helper before this migration.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.system_settings'::regclass
      and tgname = 'audit_settings_change'
      and tgfoid = to_regprocedure('public.audit_settings_change()')
      and tgtype = 17 and tgenabled in ('O', 'A') and not tgisinternal
  ) then
    raise exception 'The enabled settings AFTER UPDATE row trigger must be present before this migration.';
  end if;
end;
$$;

create or replace function public.audit_settings_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare diff text;
begin
  select string_agg(n.key || ': ' || coalesce(o.value, 'empty') || ' → ' || coalesce(n.value, 'empty'), '; ' order by n.key)
    into diff
    from jsonb_each_text(to_jsonb(new)) n
    join jsonb_each_text(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value
     and n.key not in ('updated_at', 'updated_by');
  if diff is not null then
    perform public.write_required_balance_audit('Settings Updated', left(diff, 500));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_settings_change() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
