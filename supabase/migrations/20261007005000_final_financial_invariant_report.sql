-- Read-only final invariant report. Each row must have a zero difference
-- unless the property is an inactive historical account.
create or replace view public.financial_invariant_report
with (security_invoker = true)
as
select
  p.id as property_id,
  p.homeowner_name,
  p.homeowner_status,
  coalesce(p.opening_balance, 0)::numeric(12,2) as opening_balance,
  coalesce(c.charged_amount, 0)::numeric(12,2) as active_charges,
  coalesce(pay.applied_amount, 0)::numeric(12,2) as applied_effects,
  coalesce(p.current_balance, 0)::numeric(12,2) as stored_balance,
  (
    coalesce(p.opening_balance, 0)
    + coalesce(c.charged_amount, 0)
    - coalesce(pay.applied_amount, 0)
  )::numeric(12,2) as expected_balance,
  (
    coalesce(p.opening_balance, 0)
    + coalesce(c.charged_amount, 0)
    - coalesce(pay.applied_amount, 0)
    - coalesce(p.current_balance, 0)
  )::numeric(12,2) as reconciliation_difference,
  case
    when abs(
      coalesce(p.opening_balance, 0)
      + coalesce(c.charged_amount, 0)
      - coalesce(pay.applied_amount, 0)
      - coalesce(p.current_balance, 0)
    ) <= 0.005 then 'reconciled'
    when p.homeowner_status <> 'active' then 'inactive_mismatch'
    else 'active_mismatch'
  end as invariant_status
from public.properties p
left join (
  select property_id, sum(amount) as charged_amount
  from public.property_charges
  where voided_at is null
  group by property_id
) c on c.property_id = p.id
left join (
  select property_id,
         sum(greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0))
           as applied_amount
  from public.payments
  where status is distinct from 'Voided'
  group by property_id
) pay on pay.property_id = p.id;

comment on view public.financial_invariant_report is
  'Read-only property balance invariant: opening balance plus active charges minus non-voided payment effects must equal stored balance.';

revoke all on public.financial_invariant_report from public, anon;
grant select on public.financial_invariant_report to authenticated;
