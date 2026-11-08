-- Run only in the disposable notification fixture, after the Realtime migration.
begin;
do $$
begin
 if (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'
   and tablename in ('notifications','account_activity'))<>2 then
   raise exception 'Both staff event tables must be published';
 end if;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='notification_reads') then
   raise exception 'Personal read receipts must remain unpublished';
 end if;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename in ('payments','properties','property_charges','late_payment_penalties','annual_penalty_assessments')) then
   raise exception 'Money tables must remain unpublished';
 end if;
 if not (select relrowsecurity from pg_class where oid='public.notifications'::regclass)
   or not (select relrowsecurity from pg_class where oid='public.account_activity'::regclass) then
   raise exception 'Staff event RLS must remain enabled';
 end if;
 if has_table_privilege('anon','public.notifications','select')
   or has_table_privilege('anon','public.account_activity','select')
   or has_table_privilege('authenticated','public.notifications','insert')
   or has_table_privilege('authenticated','public.account_activity','insert') then
   raise exception 'Existing staff-only permissions must remain unchanged';
 end if;
end $$;
select 'REALTIME PUBLICATION AND PRIVACY CHECKS PASSED' as result;
rollback;
