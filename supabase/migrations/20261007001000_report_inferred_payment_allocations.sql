-- Identify payment effects that still lack explicit charge allocations.
-- This report does not infer or create allocation records.
create or replace view public.payment_allocation_gaps
with (security_invoker = true)
as
select
  p.id as payment_id,
  p.receipt_number,
  p.property_id,
  p.paid_at,
  p.charge_type,
  p.coverage_period,
  coalesce(p.amount_paid, p.amount)::numeric(12,2) as cash_received,
  greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0)::numeric(12,2)
    as applied_effect,
  coalesce(sum(a.allocated_amount), 0)::numeric(12,2) as explicit_allocated_amount,
  (
    greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0)
    - coalesce(sum(a.allocated_amount), 0)
  )::numeric(12,2) as inferred_amount,
  case
    when lower(coalesce(p.coverage_period, '')) like '%advance%'
      or lower(coalesce(p.coverage_period, '')) like '%adv%'
      then 'intentional_advance_or_mixed_payment'
    when greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0) > 0
      then 'allocation_evidence_missing'
    else 'no_balance_effect'
  end as allocation_status
from public.payments p
left join public.property_payment_allocations a
  on a.payment_id = p.id
where p.status is distinct from 'Voided'
group by p.id, p.receipt_number, p.property_id, p.paid_at,
         p.charge_type, p.coverage_period, p.amount_paid, p.amount,
         p.balance_effect, p.effect_released
having greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0)
         - coalesce(sum(a.allocated_amount), 0) > 0.005;

comment on view public.payment_allocation_gaps is
  'Read-only report of active payments whose applied balance effect is not explicitly linked to property charges.';

revoke all on public.payment_allocation_gaps from public, anon;
grant select on public.payment_allocation_gaps to authenticated;
