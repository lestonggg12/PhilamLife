-- Undo only the two publication memberships added by this migration.
-- Staff event history, RLS, scheduled jobs, and financial data remain unchanged.
begin;
do $$
begin
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
  alter publication supabase_realtime drop table public.notifications;
 end if;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='account_activity') then
  alter publication supabase_realtime drop table public.account_activity;
 end if;
end $$;
commit;
