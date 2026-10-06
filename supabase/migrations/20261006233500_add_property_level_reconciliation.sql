-- Opening balances are property-wide, so they cannot be assigned to one
-- charge type without source records. Add property-level reconciliation data
-- to the allocation audit and avoid treating that ambiguity as an error.
create or replace view public.payment_charge_allocation_audit
with (security_invoker = true)
as
with charges as (
  select
    property_id,
    coalesce(charge_type, 'Association Dues') as charge_type,
    sum(amount)::numeric(12,2) as charged_amount,
    count(*)::int as charge_count
  from public.property_charges
  where voided_at is null
  group by property_id, coalesce(charge_type, 'Association Dues')
),
payments as (
  select
    property_id,
    coalesce(charge_type, 'Association Dues') as charge_type,
    sum(coalesce(amount_paid, amount))::numeric(12,2) as cash_received,
    sum(greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0))::numeric(12,2)
      as applied_amount,
    count(*)::int as payment_count
  from public.payments
  where status is distinct from 'Voided'
    and property_id is not null
  group by property_id, coalesce(charge_type, 'Association Dues')
),
combined as (
  select
    coalesce(c.property_id, p.property_id) as property_id,
    coalesce(c.charge_type, p.charge_type) as charge_type,
    coalesce(c.charged_amount, 0)::numeric(12,2) as charged_amount,
    coalesce(c.charge_count, 0)::int as charge_count,
    coalesce(p.cash_received, 0)::numeric(12,2) as cash_received,
    coalesce(p.applied_amount, 0)::numeric(12,2) as applied_amount,
    coalesce(p.payment_count, 0)::int as payment_count
  from charges c
  full outer join payments p
    on p.property_id = c.property_id
   and p.charge_type = c.charge_type
),
property_totals as (
  select
    property_id,
    sum(charged_amount)::numeric(12,2) as property_charged_amount,
    sum(applied_amount)::numeric(12,2) as property_applied_amount
  from combined
  group by property_id
),
with_context as (
  select
    combined.*,
    coalesce(p.opening_balance, 0)::numeric(12,2) as opening_balance,
    coalesce(p.current_balance, 0)::numeric(12,2) as current_balance,
    property_totals.property_charged_amount,
    property_totals.property_applied_amount
  from combined
  join property_totals using (property_id)
  left join public.properties p on p.id = combined.property_id
)
select
  property_id,
  charge_type,
  charged_amount,
  applied_amount,
  greatest(charged_amount - applied_amount, 0)::numeric(12,2) as unpaid_amount,
  cash_received,
  greatest(cash_received - applied_amount, 0)::numeric(12,2) as unallocated_amount,
  charge_count,
  payment_count,
  case
    when abs((opening_balance + property_charged_amount
      - property_applied_amount) - current_balance) <= 0.005
      then 'property_reconciles_allocation_unproven'
    when charged_amount = 0 and cash_received > 0
      then 'payment_without_charge'
    when cash_received > applied_amount + 0.005
      then 'cash_partially_unallocated'
    when charged_amount > applied_amount + 0.005
      then 'charge_partially_unpaid'
    else 'property_balance_mismatch'
  end as allocation_status,
  opening_balance,
  property_charged_amount,
  property_applied_amount,
  current_balance,
  (opening_balance + property_charged_amount
    - property_applied_amount)::numeric(12,2) as expected_current_balance,
  ((opening_balance + property_charged_amount
    - property_applied_amount) - current_balance)::numeric(12,2) as reconciliation_difference
from with_context;

comment on view public.payment_charge_allocation_audit is
  'Property-level balance reconciliation with charge-type breakdown. Opening balances are not assigned to individual charge types without evidence.';
