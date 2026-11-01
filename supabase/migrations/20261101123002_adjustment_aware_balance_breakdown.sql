-- Read-model correction only: no receipts, balances, adjustments or roles change.
begin;
set local search_path = public, pg_temp;

create or replace view public.property_balance_items
with (security_invoker = true) as
with entry_totals as (
  select property_id, sum(amount) as amount
  from public.balance_entries where voided_at is null group by property_id
), raw_items as (
  select e.property_id, 'entry'::text as kind, e.id as ref_id, e.category,
    e.as_of_date as item_date, coalesce(e.description, e.category || ' balance') as label,
    e.amount as original, null::integer as penalty_no, null::numeric as rate,
    null::numeric as base_amount, e.created_at as ordered_at,
    case when e.category = 'Association Dues' then 'dues' else e.category end as pool_type,
    0 as priority
  from public.balance_entries e where e.voided_at is null
  union all
  -- Legacy opening balances without balance-entry rows must not disappear.
  select p.id, 'opening', md5('opening:' || p.id::text)::uuid, 'Opening balance',
    p.opening_balance_as_of, coalesce(p.opening_balance_note, 'Recorded opening balance'),
    (coalesce(p.opening_balance, 0) - coalesce(e.amount, 0))::numeric(12,2),
    null::integer, null::numeric, null::numeric, p.created_at, 'dues', 0
  from public.properties p left join entry_totals e on e.property_id = p.id
  where coalesce(p.opening_balance, 0) <> coalesce(e.amount, 0)
  union all
  select c.property_id,
    case c.charge_type when 'Association Dues' then 'dues'
      when 'Penalty / Late Fee' then 'penalty' else 'charge' end,
    c.id, c.charge_type,
    coalesce(c.billing_month, lp.anniversary_date, (c.created_at at time zone 'Asia/Manila')::date),
    coalesce(c.description, c.charge_type), c.amount,
    lp.anniversary_no, lp.rate, lp.base_amount, c.created_at,
    case when c.charge_type in ('Association Dues', 'Penalty / Late Fee')
      then 'dues' else c.charge_type end,
    case c.charge_type when 'Penalty / Late Fee' then 1 when 'Association Dues' then 2 else 0 end
  from public.property_charges c
  left join lateral (
    select x.anniversary_no, x.anniversary_date, x.rate, x.base_amount
    from public.late_payment_penalties x where x.charge_id = c.id
    order by x.anniversary_no, x.anniversary_date limit 1
  ) lp on true
  where c.voided_at is null
  union all
  select a.property_id, 'adjustment', a.id, 'Account adjustment',
    (a.created_at at time zone 'Asia/Manila')::date, a.reason, a.balance_effect,
    null::integer, null::numeric, null::numeric, a.created_at, null::text, 0
  from public.account_adjustments a where a.reversed_at is null
  union all
  select a.property_id, 'adjustment', a.id, 'Moved-account reconciliation',
    (a.recorded_at at time zone 'Asia/Manila')::date, a.reason, a.adjustment_amount,
    null::integer, null::numeric, null::numeric, a.recorded_at, null::text, 0
  from public.moved_account_reconciliations a
), payment_pools as (
  select property_id,
    case when coalesce(charge_type, 'Association Dues') in ('Association Dues', 'Penalty / Late Fee')
      then 'dues' else charge_type end as pool_type,
    sum(greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0)) as effect
  from public.payments where status is distinct from 'Voided'
  group by property_id, 2
), ranked_typed as (
  select i.*, coalesce(p.effect, 0) as typed_effect,
    sum(greatest(i.original, 0)) over (partition by i.property_id, i.pool_type
      order by i.priority, i.item_date nulls first, i.ordered_at, i.ref_id
      rows between unbounded preceding and current row) as cumulative
  from raw_items i left join payment_pools p
    on p.property_id = i.property_id and p.pool_type = i.pool_type
), typed_items as (
  select r.*, greatest(0, least(greatest(original, 0), cumulative - typed_effect)) as typed_unpaid
  from ranked_typed r
), property_pools as (
  select p.id as property_id,
    -- Typed effects already used above are subtracted, so no payment is counted twice.
    greatest(coalesce(pay.effect, 0) - coalesce(i.consumed, 0), 0)
      + coalesce(i.credit, 0) as general_credit
  from public.properties p
  left join (select property_id, sum(effect) as effect from payment_pools group by property_id) pay
    on pay.property_id = p.id
  left join (
    select property_id, sum(greatest(original, 0) - typed_unpaid) as consumed,
      sum(greatest(-original, 0)) as credit
    from typed_items group by property_id
  ) i on i.property_id = p.id
), ranked_general as (
  select i.*, p.general_credit,
    sum(i.typed_unpaid) over (partition by i.property_id
      order by i.item_date nulls first, i.kind, i.ref_id
      rows between unbounded preceding and current row) as cumulative_unpaid
  from typed_items i join property_pools p using (property_id)
)
select property_id, kind, ref_id, category, item_date, label,
  original::numeric(12,2) as original,
  greatest(0, least(typed_unpaid, cumulative_unpaid - general_credit))::numeric(12,2) as unpaid,
  penalty_no, rate, base_amount
from ranked_general;

-- Preserve every existing summary column, name, order and type.
create or replace view public.homeowner_balance_breakdown
with (security_invoker = true) as
select p.id as property_id, p.homeowner_name, p.block, p.lot_number, p.homeowner_status,
  coalesce(sum(i.unpaid) filter (where i.kind = 'entry'), 0)::numeric(12,2) as entered_balance_unpaid,
  (count(*) filter (where i.kind = 'dues' and i.unpaid > 0))::integer as unpaid_dues_months,
  coalesce(sum(i.unpaid) filter (where i.kind = 'dues'), 0)::numeric(12,2) as unpaid_dues_total,
  (count(*) filter (where i.kind = 'penalty'))::integer as penalties_posted_count,
  (count(*) filter (where i.kind = 'penalty' and i.rate is not null))::integer as penalties_rated_count,
  coalesce(sum(i.original) filter (where i.kind = 'penalty'), 0)::numeric(12,2) as penalties_posted_total,
  coalesce(sum(i.unpaid) filter (where i.kind = 'penalty'), 0)::numeric(12,2) as penalties_outstanding,
  lp.original as latest_penalty_amount, lp.item_date as latest_penalty_date,
  min(i.rate) filter (where i.kind = 'penalty') as penalty_rate_min,
  max(i.rate) filter (where i.kind = 'penalty') as penalty_rate_max,
  coalesce(sum(i.unpaid), 0)::numeric(12,2) as grand_total_due,
  p.current_balance
from public.properties p
left join public.property_balance_items i on i.property_id = p.id
left join lateral (
  select x.original, x.item_date from public.property_balance_items x
  where x.property_id = p.id and x.kind = 'penalty'
  order by x.item_date desc, x.penalty_no desc nulls last limit 1
) lp on true
group by p.id, p.homeowner_name, p.block, p.lot_number, p.homeowner_status,
  p.current_balance, lp.original, lp.item_date;

create or replace view public.financial_invariant_report
with (security_invoker = true) as
with components as (
  select p.*, coalesce(c.amount, 0) as active_charges,
    coalesce(pay.effect, 0) as applied_effects,
    coalesce(m.adjustment_amount, 0) as moved_adjustment,
    coalesce(a.effect, 0) as account_adjustments
  from public.properties p
  left join (select property_id, sum(amount) as amount from public.property_charges
    where voided_at is null group by property_id) c on c.property_id = p.id
  left join (select property_id,
    sum(greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0)) as effect
    from public.payments where status is distinct from 'Voided' group by property_id) pay
    on pay.property_id = p.id
  left join public.moved_account_reconciliations m on m.property_id = p.id
  left join (select property_id, sum(balance_effect) as effect from public.account_adjustments
    where reversed_at is null group by property_id) a on a.property_id = p.id
), calculated as (
  select c.*, coalesce(opening_balance, 0) + active_charges - applied_effects
    + moved_adjustment + account_adjustments as expected
  from components c
)
select id as property_id, homeowner_name, homeowner_status,
  coalesce(opening_balance, 0)::numeric(12,2) as opening_balance,
  active_charges::numeric(12,2) as active_charges,
  applied_effects::numeric(12,2) as applied_effects,
  coalesce(current_balance, 0)::numeric(12,2) as stored_balance,
  expected::numeric(12,2) as expected_balance,
  (expected - coalesce(current_balance, 0))::numeric(12,2) as reconciliation_difference,
  case when abs(expected - coalesce(current_balance, 0)) <= 0.005 then 'reconciled'
    when homeowner_status <> 'active' then 'inactive_mismatch' else 'active_mismatch' end as invariant_status,
  -- Existing closing_adjustment remains the historical moved-account adjustment.
  moved_adjustment::numeric(12,2) as closing_adjustment,
  account_adjustments::numeric(12,2) as account_adjustments
from calculated;

-- CREATE OR REPLACE preserves existing ACLs. Keep all three views as invokers.
commit;
