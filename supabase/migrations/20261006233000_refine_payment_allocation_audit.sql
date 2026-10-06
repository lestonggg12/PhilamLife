-- Refine the allocation audit to account for legacy dues and documented
-- opening balances. This remains read-only and does not alter ledger data.
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
with_opening as (
  select
    combined.*,
    coalesce(p.opening_balance, 0)::numeric(12,2) as opening_balance
  from combined
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
    when charge_type = 'Association Dues'
      and applied_amount <= charged_amount + opening_balance + 0.005
      and applied_amount > charged_amount + 0.005
      then 'covered_by_opening_balance'
    when charge_type = 'Association Dues'
      and applied_amount > charged_amount + opening_balance + 0.005
      then 'applied_exceeds_known_balance'
    when charged_amount = 0 and cash_received > 0
      then 'payment_without_charge'
    when applied_amount > charged_amount + 0.005
      then 'applied_exceeds_charge'
    when cash_received > applied_amount + 0.005
      then 'cash_partially_unallocated'
    when charged_amount > applied_amount + 0.005
      then 'charge_partially_unpaid'
    else 'reconciled'
  end as allocation_status,
  opening_balance
from with_opening;

comment on view public.payment_charge_allocation_audit is
  'Read-only allocation audit. Legacy null charge types are treated as Association Dues; documented opening balances explain older dues effects.';
