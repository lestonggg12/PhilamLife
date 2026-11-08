-- Delivery only: publish append-only staff events; preserve existing RLS/grants.
-- Personal notification_reads and financial tables are deliberately excluded.
begin;
do $$
begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime' and pubinsert) then
  raise exception 'Supabase Realtime INSERT publication is required.';
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
  alter publication supabase_realtime add table public.notifications;
 end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='account_activity') then
  alter publication supabase_realtime add table public.account_activity;
 end if;
end $$;
commit;
