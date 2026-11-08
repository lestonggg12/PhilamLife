-- ISOLATED CONTRACT FIXTURE ONLY. Never run this file against a Supabase project.
-- Minimal live-column contract; billing/penalty engines are deliberately not installed or invoked.
create role anon;
create role authenticated;
create schema auth;
grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.profiles(id uuid primary key,role text,is_active boolean default true);
create function public.current_user_role() returns text language sql stable security definer as $$
  select lower(trim(role)) from public.profiles where id=auth.uid() and coalesce(is_active,true)
$$;
create table public.system_settings(id integer primary key,billing_day smallint,price_per_sqm numeric,due_day integer default 1,grace_period_days integer default 0);
insert into public.system_settings(id,billing_day,price_per_sqm) values(1,1,1);
create table public.properties(id bigint primary key,homeowner_name text,block text,lot_number integer,
  current_balance numeric,property_classification text,homeowner_status text,lot_size_sqm numeric,opening_balance_as_of date,created_at timestamptz default now());
create table public.property_charges(id uuid primary key default gen_random_uuid(),property_id bigint,
  charge_type text,billing_month date,amount numeric,created_at timestamptz default now(),
  created_by_name text,voided_at timestamptz,due_date date);
create table public.payments(id uuid primary key default gen_random_uuid(),amount numeric);
create table public.late_payment_penalties(id uuid primary key default gen_random_uuid(),penalty_amount numeric);
create table public.annual_penalty_assessments(id uuid primary key default gen_random_uuid(),property_id bigint,
  assessed_on date,anniversary_date date,origin text,actor_user_id uuid,penalty_amount numeric,charge_id uuid);
-- Fixture allocation inputs; the view appended below is the EXACT inspected live definition.
create table public.property_balance_items(property_id bigint,unpaid numeric,item_date date,ref_id uuid,kind text);
create table public.account_adjustments(id uuid,approval_reference text);
create table public.homeowner_balance_transfers(id uuid,effective_date date,new_property_id bigint);
create function public.hoa_manila_today() returns date language sql stable as $$
  select coalesce(nullif(current_setting('test.manila_today',true),''),'2026-05-01')::date
$$;

create function public.compute_monthly_dues(numeric,numeric) returns numeric language sql immutable parallel safe set search_path='' as $$
  select case when $1>0 and $2>0 then round($1*$2,2)::numeric(12,2) else 0::numeric(12,2) end
$$;
-- Emulates scheduler registration only; no background jobs execute in the fixture.
create schema cron;
create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text);
create function cron.schedule(text,text,text) returns bigint language sql as $$
  insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid
$$;
create function cron.unschedule(bigint) returns boolean language sql as $$
  delete from cron.job where jobid=$1 returning true
$$;

-- Exact live property_overdue_summary definition inspected on November 8, 2026.
create view public.property_overdue_summary as
 WITH settings AS (
         SELECT LEAST(GREATEST(COALESCE(system_settings.due_day, 5), 1), 31) AS due_day,
            GREATEST(COALESCE(system_settings.grace_period_days, 0), 0) AS grace_days
           FROM system_settings
          WHERE system_settings.id = 1
        ), clock AS (
         SELECT hoa_manila_today() AS today
        ), dated_items AS (
         SELECT i.property_id,
            i.unpaid,
                CASE
                    WHEN c.due_date IS NOT NULL AND c.billing_month IS NULL THEN c.due_date
                    WHEN c.billing_month IS NOT NULL THEN date_trunc('month'::text, c.billing_month::timestamp with time zone)::date + LEAST(s.due_day, EXTRACT(day FROM date_trunc('month'::text, c.billing_month::timestamp with time zone) + '1 mon -1 days'::interval)::integer) - 1 + s.grace_days
                    ELSE COALESCE(t.effective_date, i.item_date, p.opening_balance_as_of, (p.created_at AT TIME ZONE 'Asia/Manila'::text)::date) + s.grace_days
                END AS deadline,
            t.effective_date IS NULL AND i.item_date IS NULL AS used_date_fallback
           FROM property_balance_items i
             JOIN properties p ON p.id = i.property_id
             CROSS JOIN settings s
             LEFT JOIN property_charges c ON c.id = i.ref_id AND (i.kind = ANY (ARRAY['dues'::text, 'penalty'::text, 'charge'::text]))
             LEFT JOIN account_adjustments a ON a.id = i.ref_id AND i.kind = 'adjustment'::text
             LEFT JOIN homeowner_balance_transfers t ON t.id::text = a.approval_reference AND t.new_property_id = i.property_id
          WHERE i.unpaid > 0::numeric
        ), ages AS (
         SELECT i.property_id,
            i.unpaid,
            i.deadline,
            i.used_date_fallback,
            c.today - i.deadline AS age
           FROM dated_items i
             CROSS JOIN clock c
        ), totals AS (
         SELECT ages.property_id,
            sum(ages.unpaid) AS allocated,
            bool_and(ages.deadline IS NOT NULL) AS dates_known,
            COALESCE(sum(ages.unpaid) FILTER (WHERE ages.age <= 0), 0::numeric) AS current_amount,
            COALESCE(sum(ages.unpaid) FILTER (WHERE ages.age >= 1 AND ages.age <= 30), 0::numeric) AS days_1_30_amount,
            COALESCE(sum(ages.unpaid) FILTER (WHERE ages.age >= 31 AND ages.age <= 60), 0::numeric) AS days_31_60_amount,
            COALESCE(sum(ages.unpaid) FILTER (WHERE ages.age >= 61 AND ages.age <= 90), 0::numeric) AS days_61_90_amount,
            COALESCE(sum(ages.unpaid) FILTER (WHERE ages.age > 90), 0::numeric) AS days_90_plus_amount,
            COALESCE(sum(ages.unpaid) FILTER (WHERE ages.age > 0), 0::numeric) AS overdue_amount,
            COALESCE(max(ages.age) FILTER (WHERE ages.age > 0), 0) AS days_overdue,
            min(ages.deadline) FILTER (WHERE ages.age > 0) AS oldest_overdue_date,
            count(*) FILTER (WHERE ages.used_date_fallback)::integer AS aging_date_fallback_count
           FROM ages
          GROUP BY ages.property_id
        ), joined AS (
         SELECT p.id AS property_id,
            GREATEST(COALESCE(p.current_balance, 0::numeric), 0::numeric) AS balance,
            COALESCE(t.overdue_amount, 0::numeric) AS overdue_amount,
            COALESCE(t.days_overdue, 0) AS days_overdue,
            t.oldest_overdue_date,
            COALESCE(t.current_amount, 0::numeric) AS current_amount,
            COALESCE(t.days_1_30_amount, 0::numeric) AS days_1_30_amount,
            COALESCE(t.days_31_60_amount, 0::numeric) AS days_31_60_amount,
            COALESCE(t.days_61_90_amount, 0::numeric) AS days_61_90_amount,
            COALESCE(t.days_90_plus_amount, 0::numeric) AS days_90_plus_amount,
            COALESCE(t.aging_date_fallback_count, 0) AS aging_date_fallback_count,
            COALESCE(t.dates_known, true) AND abs(COALESCE(t.allocated, 0::numeric) - GREATEST(COALESCE(p.current_balance, 0::numeric), 0::numeric)) <= 0.005 AS aging_complete
           FROM properties p
             CROSS JOIN settings s
             LEFT JOIN totals t ON t.property_id = p.id
        )
 SELECT property_id,
    balance,
    overdue_amount,
    overdue_amount > 0.005 AS is_overdue,
    days_overdue,
    0::numeric AS penalty_amount,
    balance AS total_due,
    current_amount,
    days_1_30_amount,
    days_31_60_amount,
    days_61_90_amount,
    days_90_plus_amount,
    aging_date_fallback_count,
    aging_complete
   FROM joined;
