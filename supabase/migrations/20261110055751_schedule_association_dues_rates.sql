begin;
set local lock_timeout = '5s';

-- Serialize with the retired settings action and confirm there is no
-- repricing history requiring an account-level correction.
do $guard$
begin
  perform 1 from public.system_settings where id = 1 for update;
  if exists (select 1 from public.account_adjustments where adjustment_type = 'monthly_dues_reprice') then
    raise exception 'Earlier repricing adjustments exist. Review them before switching to scheduled rates.';
  end if;
end;
$guard$;

revoke execute on function public.set_price_per_sqm(numeric) from public, anon, authenticated, service_role;
drop trigger if exists b_sync_monthly_dues_rate_on_charge_status on public.property_charges;
create or replace function public.set_price_per_sqm(p_rate numeric)
returns numeric language plpgsql security definer set search_path = '' as $function$
begin
  raise exception 'Open the updated settings page to schedule a dues rate.' using errcode = '42501';
end;
$function$;
drop function if exists public.sync_monthly_dues_rate_on_charge_status();
drop function if exists public.apply_monthly_dues_rate(numeric,date,bigint);


create table public.association_dues_rates (
  effective_month date primary key check (extract(day from effective_month) = 1),
  price_per_sqm numeric(12,2) not null check (price_per_sqm > 0 and price_per_sqm < 10000000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table public.annual_dues_coverage (
  payment_id bigint primary key references public.payments(id) on delete restrict,
  property_id bigint not null references public.properties(id) on delete restrict,
  starts_on date not null check (extract(day from starts_on) = 1),
  ends_before date generated always as ((starts_on + interval '12 months')::date) stored,
  monthly_amount numeric(12,2) not null check (monthly_amount > 0)
);

create index annual_dues_coverage_property_start_idx
  on public.annual_dues_coverage (property_id, starts_on);
create index if not exists association_dues_bill_month_idx
  on public.property_charges (billing_month) where charge_type = 'Association Dues';

alter table public.association_dues_rates enable row level security;
alter table public.annual_dues_coverage enable row level security;
revoke all on public.association_dues_rates, public.annual_dues_coverage from public, anon, authenticated;
grant select on public.association_dues_rates, public.annual_dues_coverage to authenticated, service_role;
create policy "Staff read association dues rates" on public.association_dues_rates
  for select to authenticated using ((select public.current_user_role()) in ('admin','secretary','treasurer'));
create policy "Staff read annual dues coverage" on public.annual_dues_coverage
  for select to authenticated using ((select public.current_user_role()) in ('admin','secretary','treasurer'));

create function public.next_association_dues_month()
returns date language sql stable set search_path = '' as $function$
  with billing as (
    select public.hoa_manila_today() as today,
           date_trunc('month', public.hoa_manila_today())::date as month_start,
           coalesce((select billing_day from public.system_settings where id = 1), 1) as billing_day
  )
  select case
    when today >= month_start + (
      least(billing_day, extract(day from (month_start + interval '1 month - 1 day'))::int) - 1
    ) or exists (
      select 1 from public.property_charges c
      where c.billing_month = month_start and c.charge_type = 'Association Dues'
    )
    then (month_start + interval '1 month')::date
    else month_start
  end from billing;
$function$;

create function public.association_dues_rate_for_month(p_month date)
returns numeric language sql stable set search_path = '' as $function$
  select coalesce(
    (select r.price_per_sqm from public.association_dues_rates r
     where r.effective_month <= p_month order by r.effective_month desc limit 1),
    (select s.price_per_sqm from public.system_settings s where s.id = 1)
  );
$function$;

create function public.schedule_association_dues_rate(p_rate numeric, p_effective_month date)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  previous_rate numeric;
begin
  if not coalesce(public.current_user_is_admin(), false) then
    raise exception 'Only an Admin can schedule a dues rate.' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 10000000000 or p_rate <> round(p_rate, 2) then
    raise exception 'Enter a positive price below PHP 10 billion with at most two decimal places.'
      using errcode = '22023';
  end if;
  perform 1 from public.system_settings where id = 1 for update;
  if not found then raise exception 'Billing settings are unavailable.'; end if;

  if p_effective_month is null or not isfinite(p_effective_month) or extract(day from p_effective_month) <> 1
      or p_effective_month < public.next_association_dues_month()
      or exists (
        select 1 from public.property_charges c
        where c.billing_month >= p_effective_month and c.charge_type = 'Association Dues'
      ) then
    raise exception 'Choose an effective month after issued billing periods.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.properties p where p.homeowner_status = 'active'
      and round(p.lot_size_sqm * p_rate, 2) >= 10000000000
  ) then
    raise exception 'This rate is too high for at least one active lot.' using errcode = '22023';
  end if;

  previous_rate := public.association_dues_rate_for_month(p_effective_month);
  insert into public.association_dues_rates(effective_month, price_per_sqm, updated_by)
  values(p_effective_month, p_rate, auth.uid())
  on conflict (effective_month) do update
  set price_per_sqm = excluded.price_per_sqm, updated_at = now(), updated_by = excluded.updated_by
  where association_dues_rates.price_per_sqm is distinct from excluded.price_per_sqm;

  if found then
    perform public.write_audit_log('Association Dues Rate Scheduled',
      format('%s rate per sqm: PHP %s to PHP %s.', to_char(p_effective_month, 'FMMonth YYYY'),
             coalesce(previous_rate::text, 'unconfigured'), p_rate));
  end if;
end;
$function$;

revoke all on function public.schedule_association_dues_rate(numeric, date) from public, anon;
grant execute on function public.schedule_association_dues_rate(numeric, date) to authenticated;
revoke all on function public.next_association_dues_month(), public.association_dues_rate_for_month(date) from public, anon;
grant execute on function public.next_association_dues_month(), public.association_dues_rate_for_month(date) to authenticated, service_role;

create view public.association_dues_rate_status with (security_invoker = true) as
select next_month, public.association_dues_rate_for_month(next_month) as next_rate
from (select public.next_association_dues_month() as next_month) b;
revoke all on public.association_dues_rate_status from public, anon;
grant select on public.association_dues_rate_status to authenticated, service_role;

-- Coverage follows a transfer that carries advance credit. The receipt stays
-- linked to the original account.
create view public.active_annual_dues_coverage with (security_invoker = true) as
with recursive beneficiary as (
  select a.payment_id, a.property_id, a.starts_on, a.ends_before, a.monthly_amount,
         array[a.property_id] as chain
  from public.annual_dues_coverage a
  join public.payments p on p.id = a.payment_id
  where p.status is distinct from 'Voided'
  union all
  select b.payment_id, t.new_property_id, b.starts_on, b.ends_before, b.monthly_amount,
         b.chain || t.new_property_id
  from beneficiary b
  join public.homeowner_balance_transfers t on t.previous_property_id = b.property_id
  where t.transferred_balance < 0 and not t.new_property_id = any(b.chain)
)
select distinct on (payment_id) payment_id, property_id, starts_on, ends_before, monthly_amount
from beneficiary order by payment_id, cardinality(chain) desc, property_id;

revoke all on public.active_annual_dues_coverage from public, anon;
grant select on public.active_annual_dues_coverage to authenticated, service_role;

-- Legacy receipts store the discount and total but lack explicit coverage dates.
-- Infer the first eligible month from the issue date and original billing.
-- Purchases for a lot queue in receipt order.
do $legacy$
declare
  receipt record;
  first_month date;
  billing_day integer;
begin
  select coalesce(s.billing_day, 1) into billing_day from public.system_settings s where s.id = 1;
  for receipt in
    select p.id, p.property_id, p.paid_at,
           coalesce(p.payment_date, (p.paid_at at time zone 'Asia/Manila')::date) as paid_day,
           (p.receipt_breakdown->'annual_advance_discount'->>'discount_amount')::numeric as monthly_amount
    from public.payments p
    where p.property_id is not null and p.paid_at is not null
      and p.status is distinct from 'Voided' and p.charge_type = 'Association Dues'
      and p.receipt_breakdown->'annual_advance_discount'->>'months_covered' = '12'
    order by p.paid_at, p.id
  loop
    first_month := date_trunc('month', receipt.paid_day)::date;
    if receipt.paid_day >
         first_month + (least(coalesce(billing_day,1), extract(day from (first_month + interval '1 month - 1 day'))::int) - 1)
       or exists (
         select 1 from public.property_charges c
         where c.property_id = receipt.property_id and c.billing_month = first_month
           and c.charge_type = 'Association Dues' and c.created_at <= receipt.paid_at
       ) then
      first_month := (first_month + interval '1 month')::date;
    end if;

    insert into public.annual_dues_coverage(payment_id, property_id, starts_on, monthly_amount)
    select receipt.id, receipt.property_id, greatest(first_month, max(a.ends_before)), receipt.monthly_amount
    from public.active_annual_dues_coverage a where a.property_id = receipt.property_id;
  end loop;
end;
$legacy$;

create function public.next_annual_dues_start(p_property_id bigint)
returns date language sql stable set search_path = '' as $function$
  select greatest(public.next_association_dues_month(), max(a.ends_before))
  from public.active_annual_dues_coverage a where a.property_id = p_property_id;
$function$;
revoke all on function public.next_annual_dues_start(bigint) from public, anon, authenticated, service_role;

-- Payment quotes use the standard rate. The upcoming installment can use a
-- protected price if the lot has coverage for that month.
create or replace view public.property_monthly_dues with (security_invoker = true) as
select p.id as property_id, p.lot_size_sqm, b.next_rate::numeric(12,2) as price_per_sqm,
       public.compute_monthly_dues(p.lot_size_sqm, b.next_rate) as monthly_dues,
       b.next_month as billing_month,
       coalesce(a.monthly_amount, public.compute_monthly_dues(p.lot_size_sqm, b.next_rate)) as billing_amount,
       a.payment_id is not null as prepaid
from public.properties p
cross join public.association_dues_rate_status b
left join lateral (
  select x.payment_id, x.monthly_amount from public.active_annual_dues_coverage x
  where x.property_id = p.id and b.next_month >= x.starts_on and b.next_month < x.ends_before
  order by x.starts_on, x.payment_id limit 1
) a on true;

CREATE OR REPLACE FUNCTION public.prepare_payment_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  bal numeric(12,2);
  paid numeric(12,2);
  ct text;
  charged numeric(12,2);
  applied numeric(12,2);
  effect numeric(12,2);
  monthly_due numeric(12,2);
  annual_meta jsonb;
  annual_start date;
  receipt_snapshot jsonb;
  payment_property public.properties%rowtype;
  payment_recorder public.profiles%rowtype;
  actor uuid;
begin
  -- A receipt must bind to a real, currently active account. Hold its row lock
  -- through the payment so a concurrent transfer cannot invalidate this check.
  if new.property_id is null then
    raise exception 'Select an active homeowner account before recording a payment.' using errcode = '22023';
  end if;
  actor := coalesce(auth.uid(), new.recorded_by);
  select * into payment_recorder from public.profiles
    where id = actor and coalesce(is_active, true)
      and lower(btrim(role)) in ('admin', 'secretary', 'treasurer');
  if not found then
    raise exception 'An active staff recorder is required for this payment.' using errcode = '42501';
  end if;
  select * into payment_property from public.properties
    where id = new.property_id for update;
  if not found then
    raise exception 'The selected homeowner account could not be found.' using errcode = '23503';
  end if;
  if payment_property.homeowner_status is distinct from 'active' then
    raise exception 'Payments can only be recorded for active homeowner accounts. Refresh and select the current owner.' using errcode = '22023';
  end if;

  -- Ignore client-supplied identity snapshots; freeze authoritative values now.
  new.homeowner_name := payment_property.homeowner_name;
  new.block_name := payment_property.block;
  new.lot_number := payment_property.lot_number::text;
  new.recorded_by := payment_recorder.id;
  new.recorded_by_name := coalesce(nullif(btrim(payment_recorder.full_name), ''), payment_recorder.email, 'Staff user');

  if new.paid_at is null then new.paid_at := now(); end if;
  if new.created_at is null then new.created_at := now(); end if;

  if auth.uid() is not null then
    new.status := 'Completed';
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.effect_released := 0;
  end if;

  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number :=
      'OR-' || to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);
  if paid is null or paid <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  new.amount_paid := paid;

  ct := coalesce(new.charge_type, 'Association Dues');
  if ct not in (
    'Association Dues', 'Balance Payment', 'Special Assessment',
    'Penalty / Late Fee', 'Sticker / ID Fee',
    'Document / Certification Fee', 'Other'
  ) then
    ct := 'Other';
  end if;
  new.charge_type := ct;
  annual_meta := new.receipt_breakdown -> 'annual_advance_discount';

  if annual_meta is not null then
    if ct <> 'Association Dues' then
      raise exception 'The annual discount is only available for Association Dues.';
    end if;
    if new.property_id is null then
      raise exception 'A homeowner property is required for the annual discount.';
    end if;
    if coalesce((annual_meta ->> 'months_covered')::integer, 0) <> 12 then
      raise exception 'The annual discount must cover exactly 12 months.';
    end if;

    select monthly_dues into monthly_due
    from public.property_monthly_dues
    where property_id = new.property_id;

    annual_start := public.next_annual_dues_start(new.property_id);

    if monthly_due is null or monthly_due <= 0 then
      raise exception 'Could not determine the homeowner monthly dues.';
    end if;
    if round(coalesce(new.amount, 0), 2) <> round(monthly_due * 12, 2) then
      raise exception 'The regular annual dues amount does not match the current monthly dues.';
    end if;
    if round(coalesce((annual_meta ->> 'gross_amount')::numeric, 0), 2)
       <> round(new.amount, 2) then
      raise exception 'The annual dues receipt amount does not match the regular annual dues.';
    end if;
    if round(coalesce((annual_meta ->> 'discount_amount')::numeric, 0), 2)
       <> round(monthly_due, 2) then
      raise exception 'The annual discount must equal one month of dues.';
    end if;
    if round(paid, 2) <> round(new.amount - monthly_due, 2) then
      raise exception 'The amount collected must equal annual dues minus one month free.';
    end if;
    annual_meta := annual_meta || jsonb_build_object(
      'coverage_start', annual_start,
      'coverage_end', (annual_start + interval '11 months')::date
    );
  end if;

  if new.property_id is not null then
    perform public.post_due_penalties(new.property_id);

    select current_balance into bal
    from public.properties
    where id = new.property_id
    for update;
    if not found then raise exception 'Property not found.'; end if;

    if annual_meta is not null and bal > 0.005 then
      raise exception 'Clear the outstanding balance before applying the annual dues discount.';
    end if;

    if ct = 'Other' then
      select coalesce(sum(amount), 0) into charged
      from public.property_charges
      where property_id = new.property_id and charge_type = ct and voided_at is null;
      select coalesce(sum(balance_effect - effect_released), 0) into applied
      from public.payments
      where property_id = new.property_id and charge_type = ct and status <> 'Voided';
      effect := least(paid, greatest(charged - applied, 0));
    elsif annual_meta is not null then
      effect := round(new.amount, 2);
    else
      effect := paid;
    end if;

    receipt_snapshot := coalesce(public.receipt_breakdown_for(new.property_id), '{}'::jsonb);
    if annual_meta is not null then
      new.receipt_breakdown :=
        receipt_snapshot || jsonb_build_object('annual_advance_discount', annual_meta);
    else
      new.receipt_breakdown := receipt_snapshot;
    end if;

    new.previous_balance := bal;
    new.balance_effect := effect;
    new.remaining_balance := bal - effect;
    update public.properties
    set current_balance = new.remaining_balance
    where id = new.property_id;
  end if;

  return new;
end;
$function$;

create function public.record_annual_dues_coverage()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  annual_meta jsonb := new.receipt_breakdown -> 'annual_advance_discount';
begin
  if annual_meta ? 'coverage_start' then
    insert into public.annual_dues_coverage(payment_id, property_id, starts_on, monthly_amount)
    values (new.id, new.property_id, (annual_meta->>'coverage_start')::date,
            (annual_meta->>'discount_amount')::numeric);
  end if;
  return new;
end;
$function$;

create function public.guard_annual_dues_restore()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  coverage public.annual_dues_coverage%rowtype;
begin
  if old.status = 'Voided' and new.status is distinct from 'Voided'
      and old.receipt_breakdown ? 'annual_advance_discount' then
    perform 1 from public.properties where id = old.property_id for update;
    select * into coverage from public.annual_dues_coverage where payment_id = old.id;
    if not found or exists (
      select 1 from public.active_annual_dues_coverage a
      where a.property_id = old.property_id
        and a.starts_on < coverage.ends_before and a.ends_before > coverage.starts_on
    ) then
      raise exception 'This annual payment needs a coverage review before it can be restored.';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.record_annual_dues_coverage(), public.guard_annual_dues_restore()
  from public, anon, authenticated, service_role;
create trigger record_annual_dues_coverage after insert on public.payments
  for each row execute function public.record_annual_dues_coverage();
create trigger b_guard_annual_dues_restore before update of status on public.payments
  for each row execute function public.guard_annual_dues_restore();

-- A valid prepaid month uses its locked price. Re-running the job preserves
-- previously issued charges, including voided entries.
create or replace function public.bill_monthly_dues(p_month date default null)
returns integer language plpgsql security definer set search_path = '' as $function$
declare
  today date := public.hoa_manila_today();
  month_start date := date_trunc('month', coalesce(p_month, today))::date;
  rate numeric;
  billing_day integer;
  bill_date date;
  n integer;
begin
  select s.billing_day into billing_day from public.system_settings s where s.id = 1 for share;
  rate := public.association_dues_rate_for_month(month_start);
  bill_date := month_start + (least(coalesce(billing_day, 1),
    extract(day from (month_start + interval '1 month - 1 day'))::int) - 1);
  if month_start > date_trunc('month', today)::date or (p_month is null and today < bill_date) then
    return 0;
  end if;

  -- Match payment locking before reading coverage for the billing insert.
  perform p.id from public.properties p
  where p.homeowner_status = 'active'
    and (p_month is not null or (p.created_at at time zone 'Asia/Manila')::date <= bill_date)
    and not exists (
      select 1 from public.property_charges c where c.property_id = p.id
        and c.billing_month = month_start and c.charge_type = 'Association Dues'
    )
  order by p.id for update;

  with prepaid as materialized (
    select distinct on (property_id) property_id, payment_id, monthly_amount
    from public.active_annual_dues_coverage
    where month_start >= starts_on and month_start < ends_before
    order by property_id, starts_on, payment_id
  )
  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select p.id, 'Association Dues', to_char(month_start, 'FMMonth YYYY') ||
         case when a.payment_id is not null then ' monthly dues (12-month prepaid price)'
              else ' monthly dues (' || to_char(p.lot_size_sqm, 'FM99999990.00') ||
                   ' sqm × ₱' || to_char(rate, 'FM9999999990.00') || '/sqm)' end,
         coalesce(a.monthly_amount, public.compute_monthly_dues(p.lot_size_sqm, rate)),
         month_start, 'System (automatic)'
  from public.properties p
  left join prepaid a on a.property_id = p.id
  where p.homeowner_status = 'active'
    and (p_month is not null or (p.created_at at time zone 'Asia/Manila')::date <= bill_date)
    and coalesce(a.monthly_amount, public.compute_monthly_dues(p.lot_size_sqm, rate)) > 0
  on conflict (property_id, billing_month, charge_type) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Prioritize covered bills in payment allocation, including credit carried
-- by a transfer. The total receivable remains the existing net balance.
create or replace view public.property_balance_items with (security_invoker = true) as
WITH prepaid AS MATERIALIZED (
         SELECT property_id, starts_on, ends_before FROM public.active_annual_dues_coverage
        ), entry_totals AS (
         SELECT balance_entries.property_id,
            sum(balance_entries.amount) AS amount
           FROM balance_entries
          WHERE balance_entries.voided_at IS NULL
          GROUP BY balance_entries.property_id
        ), raw_items AS (
         SELECT e.property_id,
            'entry'::text AS kind,
            e.id AS ref_id,
            e.category,
            e.as_of_date AS item_date,
            COALESCE(e.description, e.category || ' balance'::text) AS label,
            e.amount AS original,
            NULL::integer AS penalty_no,
            NULL::numeric AS rate,
            NULL::numeric AS base_amount,
            e.created_at AS ordered_at,
                CASE
                    WHEN e.category = 'Association Dues'::text THEN 'dues'::text
                    ELSE e.category
                END AS pool_type,
            0 AS priority
           FROM balance_entries e
          WHERE e.voided_at IS NULL
        UNION ALL
         SELECT p.id,
            'opening'::text AS text,
            md5('opening:'::text || p.id::text)::uuid AS md5,
            'Opening balance'::text AS text,
            p.opening_balance_as_of,
            COALESCE(p.opening_balance_note, 'Recorded opening balance'::text) AS "coalesce",
            (COALESCE(p.opening_balance, 0::numeric) - COALESCE(e.amount, 0::numeric))::numeric(12,2) AS "numeric",
            NULL::integer AS int4,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            p.created_at,
            'dues'::text AS text,
            0
           FROM properties p
             LEFT JOIN entry_totals e ON e.property_id = p.id
          WHERE COALESCE(p.opening_balance, 0::numeric) <> COALESCE(e.amount, 0::numeric)
        UNION ALL
         SELECT c.property_id,
                CASE c.charge_type
                    WHEN 'Association Dues'::text THEN 'dues'::text
                    WHEN 'Penalty / Late Fee'::text THEN 'penalty'::text
                    ELSE 'charge'::text
                END AS "case",
            c.id,
            c.charge_type,
            COALESCE(c.billing_month, lp.anniversary_date, (c.created_at AT TIME ZONE 'Asia/Manila'::text)::date) AS "coalesce",
            COALESCE(c.description, c.charge_type) AS "coalesce",
            c.amount,
            lp.anniversary_no,
            lp.rate,
            lp.base_amount,
            c.created_at,
                CASE
                    WHEN c.charge_type = ANY (ARRAY['Association Dues'::text, 'Penalty / Late Fee'::text]) THEN 'dues'::text
                    ELSE c.charge_type
                END AS charge_type,
                CASE
                    WHEN c.charge_type = 'Association Dues' AND EXISTS (
                      SELECT 1 FROM prepaid a WHERE a.property_id = c.property_id
                        AND c.billing_month >= a.starts_on AND c.billing_month < a.ends_before
                    ) THEN -1
                    WHEN c.charge_type = 'Penalty / Late Fee' THEN 1
                    WHEN c.charge_type = 'Association Dues' THEN 2
                    ELSE 0
                END AS "case"
           FROM property_effective_charges c
             LEFT JOIN LATERAL ( SELECT z.anniversary_no,
                    z.anniversary_date,
                    z.rate,
                    z.base_amount
                   FROM ( SELECT x.anniversary_no,
                            x.anniversary_date,
                            x.rate,
                            x.base_amount
                           FROM late_payment_penalties x
                          WHERE x.charge_id = c.id
                        UNION ALL
                         SELECT x.anniversary_no,
                            x.anniversary_date,
                            x.rate,
                            x.base_amount
                           FROM annual_penalty_assessments x
                          WHERE x.charge_id = c.id) z
                  ORDER BY z.anniversary_no, z.anniversary_date
                 LIMIT 1) lp ON true
          WHERE c.voided_at IS NULL
        UNION ALL
         SELECT a.property_id,
            'adjustment'::text AS text,
            a.id,
            'Account adjustment'::text AS text,
            (a.created_at AT TIME ZONE 'Asia/Manila'::text)::date AS timezone,
            a.reason,
            a.balance_effect,
            NULL::integer AS int4,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            a.created_at,
            NULL::text AS text,
            0
           FROM account_adjustments a
          WHERE a.reversed_at IS NULL AND a.adjustment_type <> 'monthly_dues_reprice'::text
        UNION ALL
         SELECT a.property_id,
            'adjustment'::text AS text,
            a.id,
            'Moved-account reconciliation'::text AS text,
            (a.recorded_at AT TIME ZONE 'Asia/Manila'::text)::date AS timezone,
            a.reason,
            a.adjustment_amount,
            NULL::integer AS int4,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            a.recorded_at,
            NULL::text AS text,
            0
           FROM moved_account_reconciliations a
        ), payment_pools AS (
         SELECT payments.property_id,
                CASE
                    WHEN COALESCE(payments.charge_type, 'Association Dues'::text) = ANY (ARRAY['Association Dues'::text, 'Penalty / Late Fee'::text]) THEN 'dues'::text
                    ELSE payments.charge_type
                END AS pool_type,
            sum(GREATEST(COALESCE(payments.balance_effect, 0::numeric) - COALESCE(payments.effect_released, 0::numeric), 0::numeric)) AS effect
           FROM payments
          WHERE payments.status IS DISTINCT FROM 'Voided'::text
          GROUP BY payments.property_id, (
                CASE
                    WHEN COALESCE(payments.charge_type, 'Association Dues'::text) = ANY (ARRAY['Association Dues'::text, 'Penalty / Late Fee'::text]) THEN 'dues'::text
                    ELSE payments.charge_type
                END)
        ), ranked_typed AS (
         SELECT i.property_id,
            i.kind,
            i.ref_id,
            i.category,
            i.item_date,
            i.label,
            i.original,
            i.penalty_no,
            i.rate,
            i.base_amount,
            i.ordered_at,
            i.pool_type,
            i.priority,
            COALESCE(p.effect, 0::numeric) AS typed_effect,
            sum(GREATEST(i.original, 0::numeric)) OVER (PARTITION BY i.property_id, i.pool_type ORDER BY i.priority, i.item_date NULLS FIRST, i.ordered_at, i.ref_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative
           FROM raw_items i
             LEFT JOIN payment_pools p ON p.property_id = i.property_id AND p.pool_type = i.pool_type
        ), typed_items AS (
         SELECT r.property_id,
            r.kind,
            r.ref_id,
            r.category,
            r.item_date,
            r.label,
            r.original,
            r.penalty_no,
            r.rate,
            r.base_amount,
            r.ordered_at,
            r.pool_type,
            r.priority,
            r.typed_effect,
            r.cumulative,
            GREATEST(0::numeric, LEAST(GREATEST(r.original, 0::numeric), r.cumulative - r.typed_effect)) AS typed_unpaid
           FROM ranked_typed r
        ), property_pools AS (
         SELECT p.id AS property_id,
            GREATEST(COALESCE(pay.effect, 0::numeric) - COALESCE(i.consumed, 0::numeric), 0::numeric) + COALESCE(i.credit, 0::numeric) AS general_credit
           FROM properties p
             LEFT JOIN ( SELECT payment_pools.property_id,
                    sum(payment_pools.effect) AS effect
                   FROM payment_pools
                  GROUP BY payment_pools.property_id) pay ON pay.property_id = p.id
             LEFT JOIN ( SELECT typed_items.property_id,
                    sum(GREATEST(typed_items.original, 0::numeric) - typed_items.typed_unpaid) AS consumed,
                    sum(GREATEST(- typed_items.original, 0::numeric)) AS credit
                   FROM typed_items
                  GROUP BY typed_items.property_id) i ON i.property_id = p.id
        ), ranked_general AS (
         SELECT i.property_id,
            i.kind,
            i.ref_id,
            i.category,
            i.item_date,
            i.label,
            i.original,
            i.penalty_no,
            i.rate,
            i.base_amount,
            i.ordered_at,
            i.pool_type,
            i.priority,
            i.typed_effect,
            i.cumulative,
            i.typed_unpaid,
            p.general_credit,
            sum(i.typed_unpaid) OVER (PARTITION BY i.property_id ORDER BY (i.priority <> -1), i.item_date NULLS FIRST, i.kind, i.ref_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_unpaid
           FROM typed_items i
             JOIN property_pools p USING (property_id)
        )
 SELECT property_id,
    kind,
    ref_id,
    category,
    item_date,
    label,
    original,
    GREATEST(0::numeric, LEAST(typed_unpaid, cumulative_unpaid - general_credit))::numeric(12,2) AS unpaid,
    penalty_no,
    rate,
    base_amount
   FROM ranked_general;

do $realtime$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.association_dues_rates;
  end if;
end;
$realtime$;

commit;
