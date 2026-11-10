begin;
set local lock_timeout = '5s';

alter table public.account_adjustments
  drop constraint account_adjustments_adjustment_type_check,
  add constraint account_adjustments_adjustment_type_check check (
    adjustment_type in (
      'credit', 'waiver', 'write_off', 'refund', 'debit_correction',
      'credit_correction', 'reversal', 'monthly_dues_reprice'
    )
  ),
  add constraint account_adjustments_monthly_dues_reprice_check check (
    adjustment_type <> 'monthly_dues_reprice' or (charge_id is not null and reversed_at is null)
  );

create index account_adjustments_monthly_dues_charge_idx
  on public.account_adjustments (charge_id, property_id)
  where adjustment_type = 'monthly_dues_reprice';

-- Keep original amounts available for statements and receipts. Allocation and
-- aging use the amended amount at the original charge's date and priority.
create view public.property_effective_charges with (security_invoker = true) as
select c.id, c.property_id, c.charge_type, c.billing_month, c.created_at, c.description,
       c.voided_at, c.due_date, c.created_by_name, (c.amount + coalesce(r.effect, 0))::numeric(12,2) as amount
from public.property_charges c
left join lateral (
  select sum(a.balance_effect) as effect
  from public.account_adjustments a
  where a.charge_id = c.id and a.property_id = c.property_id
    and a.adjustment_type = 'monthly_dues_reprice'
) r on c.charge_type = 'Association Dues'
where c.voided_at is null;

revoke all on public.property_effective_charges from public, anon;
grant select on public.property_effective_charges to authenticated, service_role;

create or replace view public.property_balance_items with (security_invoker = true) as
WITH entry_totals AS (
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
            'opening'::text,
            md5('opening:'::text || p.id::text)::uuid AS md5,
            'Opening balance'::text,
            p.opening_balance_as_of,
            COALESCE(p.opening_balance_note, 'Recorded opening balance'::text) AS "coalesce",
            (COALESCE(p.opening_balance, 0::numeric) - COALESCE(e.amount, 0::numeric))::numeric(12,2) AS "numeric",
            NULL::integer AS int4,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            p.created_at,
            'dues'::text,
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
                CASE c.charge_type
                    WHEN 'Penalty / Late Fee'::text THEN 1
                    WHEN 'Association Dues'::text THEN 2
                    ELSE 0
                END AS "case"
           FROM public.property_effective_charges c
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
            'adjustment'::text,
            a.id,
            'Account adjustment'::text,
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
          WHERE a.reversed_at IS NULL AND a.adjustment_type <> 'monthly_dues_reprice'
        UNION ALL
         SELECT a.property_id,
            'adjustment'::text,
            a.id,
            'Moved-account reconciliation'::text,
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
            sum(i.typed_unpaid) OVER (PARTITION BY i.property_id ORDER BY i.item_date NULLS FIRST, i.kind, i.ref_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_unpaid
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

create or replace view public.financial_invariant_report with (security_invoker = true) as
WITH components AS (
         SELECT p.id,
            p.block,
            p.lot_number,
            p.homeowner_name,
            p.created_at,
            p.contact_phone,
            p.contact_email,
            p.contact_updated_at,
            p.homeowner_status,
            p.status_effective_date,
            p.status_reason,
            p.status_updated_at,
            p.current_balance,
            p.opening_balance,
            p.opening_balance_as_of,
            p.opening_balance_note,
            p.lot_size_sqm,
            p.homeowner_id,
            COALESCE(c.amount, 0::numeric) AS active_charges,
            COALESCE(pay.effect, 0::numeric) AS applied_effects,
            COALESCE(m.adjustment_amount, 0::numeric) AS moved_adjustment,
            COALESCE(a.effect, 0::numeric) AS account_adjustments
           FROM properties p
             LEFT JOIN ( SELECT charges.property_id, sum(charges.amount) AS amount
                   FROM public.property_effective_charges charges
                  GROUP BY charges.property_id) c ON c.property_id = p.id
             LEFT JOIN ( SELECT payments.property_id,
                    sum(GREATEST(COALESCE(payments.balance_effect, 0::numeric) - COALESCE(payments.effect_released, 0::numeric), 0::numeric)) AS effect
                   FROM payments
                  WHERE payments.status IS DISTINCT FROM 'Voided'::text
                  GROUP BY payments.property_id) pay ON pay.property_id = p.id
             LEFT JOIN moved_account_reconciliations m ON m.property_id = p.id
             LEFT JOIN ( SELECT account_adjustments.property_id,
                    sum(account_adjustments.balance_effect) AS effect
                   FROM account_adjustments
                  WHERE account_adjustments.reversed_at IS NULL
                    AND account_adjustments.adjustment_type <> 'monthly_dues_reprice'
                  GROUP BY account_adjustments.property_id) a ON a.property_id = p.id
        ), calculated AS (
         SELECT c.id,
            c.block,
            c.lot_number,
            c.homeowner_name,
            c.created_at,
            c.contact_phone,
            c.contact_email,
            c.contact_updated_at,
            c.homeowner_status,
            c.status_effective_date,
            c.status_reason,
            c.status_updated_at,
            c.current_balance,
            c.opening_balance,
            c.opening_balance_as_of,
            c.opening_balance_note,
            c.lot_size_sqm,
            c.homeowner_id,
            c.active_charges,
            c.applied_effects,
            c.moved_adjustment,
            c.account_adjustments,
            COALESCE(c.opening_balance, 0::numeric) + c.active_charges - c.applied_effects + c.moved_adjustment + c.account_adjustments AS expected
           FROM components c
        )
 SELECT id AS property_id,
    homeowner_name,
    homeowner_status,
    COALESCE(opening_balance, 0::numeric)::numeric(12,2) AS opening_balance,
    active_charges::numeric(12,2) AS active_charges,
    applied_effects::numeric(12,2) AS applied_effects,
    COALESCE(current_balance, 0::numeric)::numeric(12,2) AS stored_balance,
    expected::numeric(12,2) AS expected_balance,
    (expected - COALESCE(current_balance, 0::numeric))::numeric(12,2) AS reconciliation_difference,
        CASE
            WHEN abs(expected - COALESCE(current_balance, 0::numeric)) <= 0.005 THEN 'reconciled'::text
            WHEN homeowner_status <> 'active'::text THEN 'inactive_mismatch'::text
            ELSE 'active_mismatch'::text
        END AS invariant_status,
    moved_adjustment::numeric(12,2) AS closing_adjustment,
    account_adjustments::numeric(12,2) AS account_adjustments
   FROM calculated;

-- The scheduler takes the same settings row lock before it reads the rate.
CREATE OR REPLACE FUNCTION public.bill_monthly_dues(p_month date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  today date := public.hoa_manila_today();
  m date;
  rate numeric;
  bday integer;
  bill_date date;
  n integer;
begin
  m := date_trunc('month', coalesce(p_month, today))::date;
  select price_per_sqm, billing_day into rate, bday from public.system_settings where id = 1 for share;
  if rate is null or rate <= 0 then return 0; end if;

  bill_date := m + (least(coalesce(bday, 1),
                          extract(day from (m + interval '1 month - 1 day'))::int) - 1);

  if p_month is null and today < bill_date then return 0; end if;

  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select id, 'Association Dues',
         to_char(m, 'FMMonth YYYY') || ' monthly dues (' || to_char(lot_size_sqm, 'FM99999990.00') || ' sqm × ₱' || to_char(rate, 'FM9999999990.00') || '/sqm)',
         public.compute_monthly_dues(lot_size_sqm, rate),
         m, 'System (automatic)'
  from public.properties
  where homeowner_status = 'active'
    and public.compute_monthly_dues(lot_size_sqm, rate) > 0
    and (p_month is not null or (created_at at time zone 'Asia/Manila')::date <= bill_date)
  on conflict (property_id, billing_month, charge_type) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

create function public.apply_monthly_dues_rate(p_rate numeric, p_month date, p_property_id bigint)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  adjusted integer;
begin
  -- Match the account lock order used by the all-lot penalty job. Individual
  -- payments, transfers and charge voids also serialize on the lot row.
  perform p.id
  from public.properties p
  where p.homeowner_status = 'active'
    and (p_property_id is null or p.id = p_property_id)
  order by p.id
  for update;

  if exists (
    select 1
    from public.financial_invariant_report f
    join public.property_effective_charges c on c.property_id = f.property_id
    where c.billing_month = p_month and c.charge_type = 'Association Dues'
      and f.homeowner_status = 'active' and abs(f.reconciliation_difference) > 0.005
      and (p_property_id is null or f.property_id = p_property_id)
  ) then
    raise exception 'A current-month account does not reconcile. Review the ledger before applying the rate.';
  end if;

  with target as materialized (
    select c.id, c.property_id, c.amount as previous_amount,
           public.compute_monthly_dues(p.lot_size_sqm, p_rate) as next_amount
    from public.property_effective_charges c
    join public.properties p on p.id = c.property_id
    where c.billing_month = p_month and c.charge_type = 'Association Dues'
      and p.homeowner_status = 'active' and p.lot_size_sqm > 0
      and (p_property_id is null or p.id = p_property_id)
  ), posted as (
    insert into public.account_adjustments (
      property_id, charge_id, adjustment_type, balance_effect,
      reason, approval_reference, created_by
    )
    select property_id, id, 'monthly_dues_reprice', next_amount - previous_amount,
           format('%s association dues changed from PHP %s to PHP %s at PHP %s per sqm.',
                  to_char(p_month, 'FMMonth YYYY'), previous_amount, next_amount, p_rate),
           'Dues rate · ' || to_char(p_month, 'YYYY-MM'), auth.uid()
    from target
    where next_amount <> previous_amount
    returning property_id, balance_effect
  )
  update public.properties p
  set current_balance = p.current_balance + posted.balance_effect
  from posted where p.id = posted.property_id;

  get diagnostics adjusted = row_count;
  return adjusted;
end;
$function$;

revoke all on function public.apply_monthly_dues_rate(numeric, date, bigint)
  from public, anon, authenticated, service_role;

create or replace function public.set_price_per_sqm(p_rate numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $function$
declare
  month_start date;
  adjusted integer;
begin
  if not coalesce(public.current_user_is_admin(), false) then
    raise exception using errcode = '42501',
      message = 'Only an Admin can change the price per square meter.';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate >= 10000000000 or p_rate <> round(p_rate, 2) then
    raise exception using errcode = '22023',
      message = 'Enter a positive price below PHP 10 billion with at most two decimal places.';
  end if;

  perform 1 from public.system_settings where id = 1 for update;
  if not found then
    raise exception 'Billing settings are unavailable.';
  end if;
  month_start := date_trunc('month', public.hoa_manila_today())::date;
  adjusted := public.apply_monthly_dues_rate(p_rate, month_start, null);

  update public.system_settings
  set price_per_sqm = p_rate, updated_by = auth.uid()
  where id = 1 and (price_per_sqm is distinct from p_rate or adjusted > 0);

  if adjusted > 0 then
    perform public.write_audit_log('Monthly Dues Repriced',
      format('%s: %s lot bills adjusted at PHP %s per sqm.', to_char(month_start, 'FMMonth YYYY'), adjusted, p_rate));
  end if;
  return p_rate;
end;
$function$;

-- A bill's rate adjustments follow its status. The original charge trigger
-- has already applied the base amount and taken the lot lock.
create function public.sync_monthly_dues_rate_on_charge_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  net_adjustment numeric;
  current_rate numeric;
begin
  if new.charge_type <> 'Association Dues' or new.billing_month is null
      or (old.voided_at is null) = (new.voided_at is null) then
    return new;
  end if;

  select coalesce(sum(a.balance_effect), 0) into net_adjustment
  from public.account_adjustments a
  where a.charge_id = new.id and a.property_id = new.property_id
    and a.adjustment_type = 'monthly_dues_reprice';

  if net_adjustment <> 0 then
    update public.properties
    set current_balance = current_balance +
      case when new.voided_at is null then net_adjustment else -net_adjustment end
    where id = new.property_id;
  end if;

  if new.voided_at is null and new.billing_month = date_trunc('month', public.hoa_manila_today())::date then
    select price_per_sqm into current_rate from public.system_settings where id = 1;
    if current_rate > 0 then
      perform public.apply_monthly_dues_rate(current_rate, new.billing_month, new.property_id);
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.sync_monthly_dues_rate_on_charge_status()
  from public, anon, authenticated, service_role;

create trigger b_sync_monthly_dues_rate_on_charge_status
  after update of voided_at on public.property_charges
  for each row execute function public.sync_monthly_dues_rate_on_charge_status();

-- Existing Homeowners tabs refresh when the rate transaction commits.
do $block$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'system_settings'
     ) then
    alter publication supabase_realtime add table public.system_settings;
  end if;
end;
$block$;

commit;
