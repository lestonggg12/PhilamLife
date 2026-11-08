-- Preserve complete FUTURE settings-change descriptions. Historical rows are untouched.
-- No billing, penalty, balance, permission, trigger or scheduled-job changes.
begin;
do $$ begin
 if position('left(diff,500)' in regexp_replace(pg_get_functiondef('public.audit_settings_change()'::regprocedure),'\s','','g'))=0 then
  raise exception 'Settings audit function differs from the reviewed baseline. Review before applying.';
 end if;
end $$;
create or replace function public.audit_settings_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare diff text;
begin
 select string_agg(n.key || ': ' || coalesce(o.value, 'empty') || ' → ' || coalesce(n.value, 'empty'), '; ' order by n.key)
 into diff
 from jsonb_each_text(to_jsonb(new)) n
 join jsonb_each_text(to_jsonb(old)) o on o.key = n.key
 where n.value is distinct from o.value
 and n.key not in ('updated_at', 'updated_by');
 if diff is not null then
  perform public.write_required_balance_audit('Settings Updated', diff);
 end if;
 return new;
end;
$$;
commit;
