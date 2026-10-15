-- LOCAL REPLICA test for the treasurer permission migration.
--
-- Builds a throwaway schema that copies the LIVE policies/functions/triggers that matter
-- (as read from the production DB on 2026-10-15), runs the permission matrix as real
-- Postgres roles with RLS enforced, applies the migration, and runs it again.
-- It is NOT a test of the live database. Re-run the "scenarios" section against a Supabase
-- branch DB before relying on it in production.
--
--   createdb treasurer_test && psql -v ON_ERROR_STOP=1 -d treasurer_test \
--     -v migration=../migrations/20261015120000_restrict_treasurer_to_read_only_and_new_payments.sql \
--     -f treasurer_permissions.local.sql

\set QUIET on
\pset format unaligned
\pset tuples_only on
drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists t cascade;
create schema public; create schema auth; create schema t;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth, t to authenticated;

create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to authenticated;

create table public.profiles (id uuid primary key, role text, is_active boolean default true);
create table public.properties (id serial primary key, homeowner_name text, current_balance numeric(12,2) default 0);
create table public.blocks (id serial primary key, name text);
create table public.payments (id serial primary key, property_id int references public.properties(id), amount_paid numeric(12,2),
  status text default 'Completed', void_reason text, recorded_by uuid, receipt_number text);
create table public.property_charges (id uuid primary key default gen_random_uuid(), property_id int references public.properties(id), charge_type text,
  amount numeric(12,2), created_by uuid, billing_month date, voided_at timestamptz, void_reason text);
create table public.service_transactions (id uuid primary key default gen_random_uuid(), payment_status text default 'paid', receipt_number text,
  balance_of uuid, voided_at timestamptz, voided_by uuid, void_reason text);
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

create function public.current_user_role() returns text language sql stable security definer
  set search_path to 'public','pg_temp' as
$$ select lower(trim(p.role)) from public.profiles p where p.id = auth.uid() and coalesce(p.is_active,true) = true limit 1 $$;
grant execute on function public.current_user_role() to authenticated;

-- Live trigger behavior (simplified): new payments reduce the balance via a SECURITY DEFINER
-- trigger; direct client edits of current_balance are reverted at trigger depth 1.
create function public.prepare_payment_record() returns trigger language plpgsql security definer set search_path to 'public' as
$$ begin update public.properties set current_balance = current_balance - new.amount_paid where id = new.property_id; return new; end $$;
create trigger prepare_payment_before_insert before insert on public.payments for each row execute function public.prepare_payment_record();
create function public.protect_property_balance() returns trigger language plpgsql set search_path to 'public' as
$$ begin if auth.uid() is not null and pg_trigger_depth() = 1 then new.current_balance := old.current_balance; end if; return new; end $$;
create trigger protect_property_balance before update on public.properties for each row execute function public.protect_property_balance();

alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.blocks enable row level security;
alter table public.payments enable row level security;
alter table public.property_charges enable row level security;
alter table public.service_transactions enable row level security;

-- LIVE policies (pre-migration), copied from pg_policies.
create policy "Staff can view profiles" on public.profiles for select to authenticated using (current_user_role() = any (array['admin','secretary','treasurer']));
create policy "Staff can view properties" on public.properties for select to authenticated using (current_user_role() = any (array['admin','secretary','treasurer']));
create policy "Admin and Secretary can create properties" on public.properties for insert to authenticated with check (current_user_role() = any (array['admin','secretary']));
create policy "Admin and Secretary can update properties" on public.properties for update to authenticated using (current_user_role() = any (array['admin','secretary'])) with check (current_user_role() = any (array['admin','secretary']));
create policy "Admin and Secretary can delete properties" on public.properties for delete to authenticated using (current_user_role() = any (array['admin','secretary']));
create policy "Staff can view blocks" on public.blocks for select to authenticated using (current_user_role() = any (array['admin','secretary','treasurer']));
create policy "Admin and Secretary can create blocks" on public.blocks for insert to authenticated with check (current_user_role() = any (array['admin','secretary']));
create policy "Admin and Secretary can update blocks" on public.blocks for update to authenticated using (current_user_role() = any (array['admin','secretary'])) with check (current_user_role() = any (array['admin','secretary']));
create policy "Admin and Secretary can delete blocks" on public.blocks for delete to authenticated using (current_user_role() = any (array['admin','secretary']));
create policy "Staff can view payments" on public.payments for select to authenticated using (current_user_role() = any (array['admin','secretary','treasurer']));
create policy "Admin, Secretary, and Treasurer can create payments" on public.payments for insert to authenticated
  with check (((select current_user_role()) = any (array['admin','secretary','treasurer'])) and (recorded_by = (select auth.uid())));
create policy "Secretary and Treasurer can update payments" on public.payments for update to authenticated
  using (current_user_role() = any (array['secretary','treasurer'])) with check (current_user_role() = any (array['secretary','treasurer']));
create policy "Staff can view charges" on public.property_charges for select to authenticated using (current_user_role() = any (array['admin','secretary','treasurer']));
create policy "Staff can add manual charges" on public.property_charges for insert to authenticated
  with check (((select current_user_role()) = any (array['admin','secretary','treasurer'])) and (created_by = (select auth.uid())) and (billing_month is null) and (voided_at is null));
create policy "Staff can void charges" on public.property_charges for update to authenticated
  using (current_user_role() = any (array['admin','secretary','treasurer'])) with check (current_user_role() = any (array['admin','secretary','treasurer']));
create policy "Staff can view service transactions" on public.service_transactions for select to authenticated using (current_user_role() = any (array['admin','secretary','treasurer']));

create function public.restore_voided_charge(p_charge_id uuid) returns void language plpgsql security definer set search_path to 'public','pg_temp' as
$$ begin
  if coalesce(public.current_user_role(), '') not in ('admin','secretary','treasurer') then raise exception 'You do not have permission to restore charges.'; end if;
  update public.property_charges set voided_at = null where id = p_charge_id and voided_at is not null and charge_type = 'Association Dues';
  if not found then raise exception 'Only a voided monthly dues charge can be restored.'; end if;
end $$;
create function public.void_service_transaction(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path to 'public' as
$$ begin
  if coalesce(public.current_user_role(), '') not in ('secretary','treasurer') then raise exception 'You do not have permission to void service receipts.'; end if;
  update public.service_transactions set payment_status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = p_id;
end $$;
revoke execute on all functions in schema public from public;
grant execute on function public.restore_voided_charge(uuid), public.void_service_transaction(uuid, text) to authenticated;

-- Test helpers. t.try() runs one statement as the CURRENT role and returns rows affected (or -1 on error).
create table t.results (phase text, name text, expect text, ok boolean);
grant insert on t.results to authenticated;
create function t.try(sql text) returns int language plpgsql as
$$ declare n int; begin execute sql; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
create function t.try_call(sql text) returns int language plpgsql as
$$ begin execute sql; return 1; exception when others then return -1; end $$;
grant execute on all functions in schema t to authenticated;
create function t.as_user(uid text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', uid, false); end $$;
grant execute on function t.as_user(text) to authenticated;

create or replace function t.seed() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);  -- seed as the DB owner, not as a previous test user
  truncate public.payments, public.property_charges, public.service_transactions, public.properties, public.blocks restart identity cascade;
  insert into public.properties (homeowner_name, current_balance) values ('Seed Homeowner', 5000), ('Throwaway Homeowner', 0);
  insert into public.blocks (name) values ('Block A');
  insert into public.payments (property_id, amount_paid, recorded_by) values (1, 100, '00000000-0000-0000-0000-00000000000c');
  insert into public.property_charges (id, property_id, charge_type, amount, created_by) values ('00000000-0000-0000-0000-000000000c01', 1, 'Penalty / Late Fee', 50, '00000000-0000-0000-0000-00000000000c');
  insert into public.property_charges (id, property_id, charge_type, amount, created_by, voided_at, void_reason) values ('00000000-0000-0000-0000-000000000c02', 1, 'Association Dues', 300, '00000000-0000-0000-0000-00000000000c', now(), 'seed');
  insert into public.service_transactions (id, receipt_number) values ('00000000-0000-0000-0000-000000000501', 'S-1'), ('00000000-0000-0000-0000-000000000502', 'S-2');
  update public.properties set current_balance = 5000 where id = 1;
end $$;

create function t.rec(phase text, name text, expect text, n int) returns void language plpgsql as
$$ begin insert into t.results values (phase, name, expect, case expect when 'allowed' then n >= 1 else n <= 0 end); end $$;
grant execute on function t.rec(text,text,text,int) to authenticated;

reset role;
insert into public.profiles values
  ('00000000-0000-0000-0000-0000000000a1','admin'),
  ('00000000-0000-0000-0000-0000000000b2','secretary'),
  ('00000000-0000-0000-0000-0000000000c3','treasurer');

-- ===== Phase 1: BEFORE the migration (shows the live gaps; treasurer rows are expected to FAIL) =====
\set phase before

reset role; select t.seed();
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.rec(:'phase', $n$treasurer: view homeowners list$n$, 'allowed', t.try($q$select 1 from public.properties$q$));
select t.rec(:'phase', $n$treasurer: view payment history$n$, 'allowed', t.try($q$select 1 from public.payments$q$));
select t.rec(:'phase', $n$treasurer: view charges/ledger data$n$, 'allowed', t.try($q$select 1 from public.property_charges$q$));
select t.rec(:'phase', $n$treasurer: record a new payment (as self)$n$, 'allowed', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 200, '00000000-0000-0000-0000-0000000000c3')$q$));
select t.rec(:'phase', $n$treasurer: record payment with forged recorded_by$n$, 'denied', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 200, '00000000-0000-0000-0000-0000000000b2')$q$));
select t.rec(:'phase', $n$treasurer: void an existing payment$n$, 'denied', t.try($q$update public.payments set status='Voided', void_reason='no reason given' where id=1$q$));
select t.rec(:'phase', $n$treasurer: edit an existing payment$n$, 'denied', t.try($q$update public.payments set amount_paid=1 where id=1$q$));
select t.rec(:'phase', $n$treasurer: delete a payment$n$, 'denied', t.try($q$delete from public.payments where id=1$q$));
select t.rec(:'phase', $n$treasurer: add a charge (direct balance change)$n$, 'denied', t.try($q$insert into public.property_charges (property_id, charge_type, amount, created_by) values (1,'Penalty / Late Fee',10,'00000000-0000-0000-0000-0000000000c3')$q$));
select t.rec(:'phase', $n$treasurer: void a charge$n$, 'denied', t.try($q$update public.property_charges set voided_at=now(), void_reason='no reason given' where id='00000000-0000-0000-0000-000000000c01'$q$));
select t.rec(:'phase', $n$treasurer: edit homeowner information$n$, 'denied', t.try($q$update public.properties set homeowner_name='Hacked' where id=1$q$));
select t.rec(:'phase', $n$treasurer: delete a homeowner$n$, 'denied', t.try($q$delete from public.properties where id=2$q$));
select t.rec(:'phase', $n$treasurer: create a homeowner$n$, 'denied', t.try($q$insert into public.properties (homeowner_name) values ('New')$q$));
select t.rec(:'phase', $n$treasurer: set balance directly$n$, 'denied', t.try($q$update public.properties set current_balance=0 where id=1$q$));
select t.rec(:'phase', $n$treasurer: edit/create blocks$n$, 'denied', t.try($q$insert into public.blocks (name) values ('Block Z')$q$));
select t.rec(:'phase', $n$treasurer: RPC restore_voided_charge$n$, 'denied', t.try_call($q$select public.restore_voided_charge('00000000-0000-0000-0000-000000000c02')$q$));
select t.rec(:'phase', $n$treasurer: RPC void_service_transaction$n$, 'denied', t.try_call($q$select public.void_service_transaction('00000000-0000-0000-0000-000000000501','reason is long enough')$q$));
reset role;
select t.rec(:'phase','treasurer: new payment lowered balance via trigger (5000 -> 4800)','allowed',(select count(*)::int from public.properties where id=1 and current_balance=4800));
select t.rec(:'phase','treasurer: denied attempts left data unchanged','allowed',(select count(*)::int from public.payments where id=1 and status='Completed' and amount_paid=100) * (select count(*)::int from public.properties where id=1 and homeowner_name='Seed Homeowner') * (select count(*)::int from public.property_charges where id='00000000-0000-0000-0000-000000000c01' and voided_at is null) * (select count(*)::int from public.properties where id=2));

reset role; select t.seed();
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.rec(:'phase', $n$secretary: void a payment$n$, 'allowed', t.try($q$update public.payments set status='Voided', void_reason='no reason given' where id=1$q$));
select t.rec(:'phase', $n$secretary: record a payment$n$, 'allowed', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 50, '00000000-0000-0000-0000-0000000000b2')$q$));
select t.rec(:'phase', $n$secretary: add a charge$n$, 'allowed', t.try($q$insert into public.property_charges (property_id, charge_type, amount, created_by) values (1,'Penalty / Late Fee',10,'00000000-0000-0000-0000-0000000000b2')$q$));
select t.rec(:'phase', $n$secretary: void a charge$n$, 'allowed', t.try($q$update public.property_charges set voided_at=now(), void_reason='no reason given' where id='00000000-0000-0000-0000-000000000c01'$q$));
select t.rec(:'phase', $n$secretary: edit homeowner$n$, 'allowed', t.try($q$update public.properties set homeowner_name='Renamed' where id=1$q$));
select t.rec(:'phase', $n$secretary: delete homeowner$n$, 'allowed', t.try($q$delete from public.properties where id=2$q$));
select t.rec(:'phase', $n$secretary: RPC restore_voided_charge$n$, 'allowed', t.try_call($q$select public.restore_voided_charge('00000000-0000-0000-0000-000000000c02')$q$));
select t.rec(:'phase', $n$secretary: RPC void_service_transaction$n$, 'allowed', t.try_call($q$select public.void_service_transaction('00000000-0000-0000-0000-000000000501','reason is long enough')$q$));
reset role;

reset role; select t.seed();
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.rec(:'phase', $n$admin: record a payment$n$, 'allowed', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 50, '00000000-0000-0000-0000-0000000000a1')$q$));
select t.rec(:'phase', $n$admin: add a charge$n$, 'allowed', t.try($q$insert into public.property_charges (property_id, charge_type, amount, created_by) values (1,'Penalty / Late Fee',10,'00000000-0000-0000-0000-0000000000a1')$q$));
select t.rec(:'phase', $n$admin: void a charge$n$, 'allowed', t.try($q$update public.property_charges set voided_at=now(), void_reason='no reason given' where id='00000000-0000-0000-0000-000000000c01'$q$));
select t.rec(:'phase', $n$admin: edit homeowner$n$, 'allowed', t.try($q$update public.properties set homeowner_name='Renamed' where id=1$q$));
select t.rec(:'phase', $n$admin: RPC restore_voided_charge$n$, 'allowed', t.try_call($q$select public.restore_voided_charge('00000000-0000-0000-0000-000000000c02')$q$));
select t.rec(:'phase', $n$admin: update a payment (never allowed for admin; unchanged)$n$, 'denied', t.try($q$update public.payments set status='Voided', void_reason='no reason given' where id=1$q$));
select t.rec(:'phase', $n$admin: RPC void_service_transaction (never allowed for admin; unchanged)$n$, 'denied', t.try_call($q$select public.void_service_transaction('00000000-0000-0000-0000-000000000501','reason is long enough')$q$));
reset role;

-- ===== Apply the migration =====
reset role;
\i :migration

-- ===== Phase 2: AFTER the migration (every row must pass) =====
\set phase after

reset role; select t.seed();
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000c3');
select t.rec(:'phase', $n$treasurer: view homeowners list$n$, 'allowed', t.try($q$select 1 from public.properties$q$));
select t.rec(:'phase', $n$treasurer: view payment history$n$, 'allowed', t.try($q$select 1 from public.payments$q$));
select t.rec(:'phase', $n$treasurer: view charges/ledger data$n$, 'allowed', t.try($q$select 1 from public.property_charges$q$));
select t.rec(:'phase', $n$treasurer: record a new payment (as self)$n$, 'allowed', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 200, '00000000-0000-0000-0000-0000000000c3')$q$));
select t.rec(:'phase', $n$treasurer: record payment with forged recorded_by$n$, 'denied', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 200, '00000000-0000-0000-0000-0000000000b2')$q$));
select t.rec(:'phase', $n$treasurer: void an existing payment$n$, 'denied', t.try($q$update public.payments set status='Voided', void_reason='no reason given' where id=1$q$));
select t.rec(:'phase', $n$treasurer: edit an existing payment$n$, 'denied', t.try($q$update public.payments set amount_paid=1 where id=1$q$));
select t.rec(:'phase', $n$treasurer: delete a payment$n$, 'denied', t.try($q$delete from public.payments where id=1$q$));
select t.rec(:'phase', $n$treasurer: add a charge (direct balance change)$n$, 'denied', t.try($q$insert into public.property_charges (property_id, charge_type, amount, created_by) values (1,'Penalty / Late Fee',10,'00000000-0000-0000-0000-0000000000c3')$q$));
select t.rec(:'phase', $n$treasurer: void a charge$n$, 'denied', t.try($q$update public.property_charges set voided_at=now(), void_reason='no reason given' where id='00000000-0000-0000-0000-000000000c01'$q$));
select t.rec(:'phase', $n$treasurer: edit homeowner information$n$, 'denied', t.try($q$update public.properties set homeowner_name='Hacked' where id=1$q$));
select t.rec(:'phase', $n$treasurer: delete a homeowner$n$, 'denied', t.try($q$delete from public.properties where id=2$q$));
select t.rec(:'phase', $n$treasurer: create a homeowner$n$, 'denied', t.try($q$insert into public.properties (homeowner_name) values ('New')$q$));
select t.rec(:'phase', $n$treasurer: set balance directly$n$, 'denied', t.try($q$update public.properties set current_balance=0 where id=1$q$));
select t.rec(:'phase', $n$treasurer: edit/create blocks$n$, 'denied', t.try($q$insert into public.blocks (name) values ('Block Z')$q$));
select t.rec(:'phase', $n$treasurer: RPC restore_voided_charge$n$, 'denied', t.try_call($q$select public.restore_voided_charge('00000000-0000-0000-0000-000000000c02')$q$));
select t.rec(:'phase', $n$treasurer: RPC void_service_transaction$n$, 'denied', t.try_call($q$select public.void_service_transaction('00000000-0000-0000-0000-000000000501','reason is long enough')$q$));
reset role;
select t.rec(:'phase','treasurer: new payment lowered balance via trigger (5000 -> 4800)','allowed',(select count(*)::int from public.properties where id=1 and current_balance=4800));
select t.rec(:'phase','treasurer: denied attempts left data unchanged','allowed',(select count(*)::int from public.payments where id=1 and status='Completed' and amount_paid=100) * (select count(*)::int from public.properties where id=1 and homeowner_name='Seed Homeowner') * (select count(*)::int from public.property_charges where id='00000000-0000-0000-0000-000000000c01' and voided_at is null) * (select count(*)::int from public.properties where id=2));

reset role; select t.seed();
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.rec(:'phase', $n$secretary: void a payment$n$, 'allowed', t.try($q$update public.payments set status='Voided', void_reason='no reason given' where id=1$q$));
select t.rec(:'phase', $n$secretary: record a payment$n$, 'allowed', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 50, '00000000-0000-0000-0000-0000000000b2')$q$));
select t.rec(:'phase', $n$secretary: add a charge$n$, 'allowed', t.try($q$insert into public.property_charges (property_id, charge_type, amount, created_by) values (1,'Penalty / Late Fee',10,'00000000-0000-0000-0000-0000000000b2')$q$));
select t.rec(:'phase', $n$secretary: void a charge$n$, 'allowed', t.try($q$update public.property_charges set voided_at=now(), void_reason='no reason given' where id='00000000-0000-0000-0000-000000000c01'$q$));
select t.rec(:'phase', $n$secretary: edit homeowner$n$, 'allowed', t.try($q$update public.properties set homeowner_name='Renamed' where id=1$q$));
select t.rec(:'phase', $n$secretary: delete homeowner$n$, 'allowed', t.try($q$delete from public.properties where id=2$q$));
select t.rec(:'phase', $n$secretary: RPC restore_voided_charge$n$, 'allowed', t.try_call($q$select public.restore_voided_charge('00000000-0000-0000-0000-000000000c02')$q$));
select t.rec(:'phase', $n$secretary: RPC void_service_transaction$n$, 'allowed', t.try_call($q$select public.void_service_transaction('00000000-0000-0000-0000-000000000501','reason is long enough')$q$));
reset role;

reset role; select t.seed();
set role authenticated; select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.rec(:'phase', $n$admin: record a payment$n$, 'allowed', t.try($q$insert into public.payments (property_id, amount_paid, recorded_by) values (1, 50, '00000000-0000-0000-0000-0000000000a1')$q$));
select t.rec(:'phase', $n$admin: add a charge$n$, 'allowed', t.try($q$insert into public.property_charges (property_id, charge_type, amount, created_by) values (1,'Penalty / Late Fee',10,'00000000-0000-0000-0000-0000000000a1')$q$));
select t.rec(:'phase', $n$admin: void a charge$n$, 'allowed', t.try($q$update public.property_charges set voided_at=now(), void_reason='no reason given' where id='00000000-0000-0000-0000-000000000c01'$q$));
select t.rec(:'phase', $n$admin: edit homeowner$n$, 'allowed', t.try($q$update public.properties set homeowner_name='Renamed' where id=1$q$));
select t.rec(:'phase', $n$admin: RPC restore_voided_charge$n$, 'allowed', t.try_call($q$select public.restore_voided_charge('00000000-0000-0000-0000-000000000c02')$q$));
select t.rec(:'phase', $n$admin: update a payment (never allowed for admin; unchanged)$n$, 'denied', t.try($q$update public.payments set status='Voided', void_reason='no reason given' where id=1$q$));
select t.rec(:'phase', $n$admin: RPC void_service_transaction (never allowed for admin; unchanged)$n$, 'denied', t.try_call($q$select public.void_service_transaction('00000000-0000-0000-0000-000000000501','reason is long enough')$q$));
reset role;

reset role;
\pset format aligned
\pset tuples_only off
select phase, count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results group by phase order by phase desc;
select phase, name, expect from t.results where not ok order by phase desc, name;
