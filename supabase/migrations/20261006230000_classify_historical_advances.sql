-- Classify receipts explicitly marked as advance payments.
-- The excess remains credit and is not treated as a fee overpayment.
create or replace view public.payment_reconciliation_issues
with (security_invoker = true)
as
with active_charges as (
  select
    property_id,
    charge_type,
    sum(amount) as charged
  from public.property_charges
  where voided_at is null
  group by property_id, charge_type
)
select
  p.id as payment_id,
  p.property_id,
  p.paid_at,
  p.charge_type,
  p.amount_paid,
  coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0) as payment_balance_effect,
  case
    when lower(coalesce(p.coverage_period, '')) like '%advance%'
      or lower(coalesce(p.coverage_period, '')) like '%adv%'
      then 'intentional_advance_credit'
    when p.charge_type in (
        'Special Assessment',
        'Penalty / Late Fee',
        'Sticker / ID Fee',
        'Document / Certification Fee'
      )
      and coalesce(ac.charged, 0) = 0
      and coalesce(p.amount_paid, p.amount) > 0
      then 'fee_payment_without_active_charge'
    when coalesce(p.amount_paid, p.amount) >
      greatest(
        coalesce(ac.charged, 0) - coalesce((
          select sum(coalesce(p2.balance_effect, 0) - coalesce(p2.effect_released, 0))
          from public.payments p2
          where p2.property_id = p.property_id
            and p2.charge_type = p.charge_type
            and p2.status <> 'Voided'
            and p2.id <> p.id
        ), 0),
        0
      ) + 0.005
      then 'payment_exceeds_current_unpaid_charge'
    when coalesce(p.amount_paid, p.amount) >
      greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0) + 0.005
      then 'cash_not_fully_applied'
    else null
  end as issue_type,
  p.coverage_period,
  greatest(
    coalesce(p.amount_paid, p.amount)
      - greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0),
    0
  ) as unallocated_amount
from public.payments p
left join active_charges ac
  on ac.property_id = p.property_id
 and ac.charge_type = p.charge_type
where p.status <> 'Voided'
  and (
    lower(coalesce(p.coverage_period, '')) like '%advance%'
    or lower(coalesce(p.coverage_period, '')) like '%adv%'
    or (
      p.charge_type in (
        'Special Assessment',
        'Penalty / Late Fee',
        'Sticker / ID Fee',
        'Document / Certification Fee'
      )
      and coalesce(ac.charged, 0) = 0
    )
    or coalesce(p.amount_paid, p.amount) >
      greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0) + 0.005
  );

comment on view public.payment_reconciliation_issues is
  'Read-only report of payments whose cash is not fully applied, including intentional advance credits.';
