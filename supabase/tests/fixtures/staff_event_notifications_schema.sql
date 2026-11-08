-- ISOLATED ONLY: extends system_notifications_isolated_schema.sql after the base migration/tests.
alter table public.profiles add column full_name text;
alter table public.system_settings add column updated_by uuid;
alter table public.properties add column homeowner_id uuid;
alter table public.properties add column status_effective_date date;
alter table public.properties add column status_reason text;
alter table public.property_charges add column created_by uuid;
alter table public.property_charges add column voided_by uuid;
alter table public.property_charges add column void_reason text;
alter table public.payments add column property_id bigint;
alter table public.payments add column status text;
alter table public.payments add column amount_paid numeric;
alter table public.payments add column receipt_number text;
alter table public.payments add column voided_at timestamptz;
alter table public.payments add column voided_by uuid;
alter table public.payments add column void_reason text;
create table public.balance_entries(id uuid primary key default gen_random_uuid(),property_id bigint,amount numeric,voided_at timestamptz,voided_by uuid,void_reason text);
create table public.service_transactions(id uuid primary key default gen_random_uuid(),property_id bigint,amount_paid numeric,receipt_number text,balance_of uuid,payment_status text,voided_at timestamptz,voided_by uuid,void_reason text);
create table public.expenses(id uuid primary key default gen_random_uuid(),amount numeric,status text,voided_at timestamptz,voided_by uuid,void_reason text,reference_number text);
alter table public.account_adjustments add column property_id bigint;
alter table public.account_adjustments add column balance_effect numeric;
alter table public.account_adjustments add column reversed_at timestamptz;
alter table public.account_adjustments add column reversed_by uuid;
alter table public.account_adjustments add column reversal_reason text;
create table public.manual_payment_discounts(id uuid primary key default gen_random_uuid(),payment_id uuid,property_id bigint,charge_id uuid,adjustment_id uuid,discount_amount numeric);
create table public.annual_penalty_schedules(id uuid primary key default gen_random_uuid(),source_kind text,source_ref uuid,property_id bigint);
alter table public.annual_penalty_assessments add column schedule_id uuid;
alter table public.annual_penalty_assessments add column base_amount numeric;
alter table public.annual_penalty_assessments add column rate numeric;
alter table public.annual_penalty_assessments add column posted_at timestamptz default now();
alter table public.late_payment_penalties add column property_id bigint;
alter table public.late_payment_penalties add column balance_entry_id uuid;
alter table public.late_payment_penalties add column charge_id uuid;
alter table public.late_payment_penalties add column base_amount numeric;
alter table public.late_payment_penalties add column rate numeric;
alter table public.late_payment_penalties add column anniversary_date date;
alter table public.late_payment_penalties add column posted_at timestamptz default now();
alter table public.homeowner_balance_transfers add column previous_property_id bigint;
alter table public.homeowner_balance_transfers add column transferred_balance numeric;
alter table public.homeowner_balance_transfers add column note text;
alter table public.homeowner_balance_transfers add column created_by uuid;
alter table public.homeowner_balance_transfers add column created_at timestamptz default now();
create table public.expense_budgets(budget_year integer,category text,approved_annual_amount numeric,approval_note text,updated_by uuid,updated_at timestamptz default now(),primary key(budget_year,category));
create table public.annual_penalty_rate_rules(id uuid primary key default gen_random_uuid(),property_classification text,effective_from date,annual_rate numeric,rule_note text,created_by uuid,created_at timestamptz default now());
create table public.annual_penalty_rate_overrides(like public.annual_penalty_rate_rules including all);
create table public.annual_penalty_rate_supersessions(rule_id uuid,override_id uuid);
-- EXACT inspected live charge balance function. This validates observer ordering;
-- source money effects are compared with/without the observers in the tests.
create function public.apply_charge_to_balance() returns trigger language plpgsql security definer set search_path='public','pg_temp' as $$
begin
 if tg_op='INSERT' then
  update public.properties set current_balance=current_balance+new.amount where id=new.property_id;
 elsif old.voided_at is null and new.voided_at is not null then
  update public.properties set current_balance=current_balance-new.amount where id=new.property_id;
 elsif old.voided_at is not null and new.voided_at is null then
  update public.properties set current_balance=current_balance+new.amount where id=new.property_id;
 end if;
 return new;
end $$;
create trigger apply_charge_to_balance after insert or update of voided_at on public.property_charges for each row execute function public.apply_charge_to_balance();

-- Equivalent source-penalty cascade from the inspected live function.
create function public.void_annual_source_penalties() returns trigger language plpgsql as $$
begin
 if old.voided_at is null and new.voided_at is not null then
  update public.property_charges c set voided_at=now(),voided_by=auth.uid(),void_reason='Source voided'
  where c.voided_at is null and c.id in (
   select a.charge_id from public.annual_penalty_assessments a join public.annual_penalty_schedules s on s.id=a.schedule_id
   where s.source_ref=new.id and s.property_id=new.property_id and s.source_kind='entry');
 end if;
 return new;
end $$;
create trigger void_annual_entry_penalties after update of voided_at on public.balance_entries for each row execute function public.void_annual_source_penalties();
