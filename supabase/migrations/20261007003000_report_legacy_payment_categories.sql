-- Read-only classification report for legacy payments whose charge_type is
-- missing or disagrees with the receipt coverage text.
create or replace view public.legacy_payment_category_audit
with (security_invoker = true)
as
with classified as (
  select
    p.id as payment_id,
    p.receipt_number,
    p.property_id,
    p.paid_at,
    p.coverage_period,
    p.charge_type,
    coalesce(p.amount_paid, p.amount)::numeric(12,2) as cash_received,
    greatest(coalesce(p.balance_effect, 0) - coalesce(p.effect_released, 0), 0)::numeric(12,2)
      as applied_effect,
    p.status,
    case
      when lower(coalesce(p.coverage_period, '')) ~ 'sticker|id fee'
        then 'Sticker / ID Fee'
      when lower(coalesce(p.coverage_period, '')) ~ 'document|certification|certificate'
        then 'Document / Certification Fee'
      when lower(coalesce(p.coverage_period, '')) ~ 'special assessment'
        then 'Special Assessment'
      when lower(coalesce(p.coverage_period, '')) ~ 'penalty|late fee'
        then 'Penalty / Late Fee'
      when lower(coalesce(p.coverage_period, '')) ~ 'association dues|monthly dues|advance payment'
        then 'Association Dues'
      when nullif(trim(p.charge_type), '') is not null
        then trim(p.charge_type)
      else null
    end as inferred_charge_type
  from public.payments p
)
select
  payment_id,
  receipt_number,
  property_id,
  paid_at,
  coverage_period,
  charge_type,
  inferred_charge_type,
  cash_received,
  applied_effect,
  status,
  case
    when status = 'Voided' then 'voided'
    when charge_type is null and inferred_charge_type is null then 'ambiguous_missing_category'
    when charge_type is null then 'legacy_category_inferred'
    when inferred_charge_type is not null
      and lower(trim(charge_type)) <> lower(inferred_charge_type)
      then 'category_conflicts_with_coverage'
    else 'category_consistent'
  end as classification_status
from classified
where charge_type is null
   or inferred_charge_type is null
   or lower(trim(charge_type)) <> lower(inferred_charge_type);

comment on view public.legacy_payment_category_audit is
  'Read-only report of legacy payment categories inferred from receipt coverage text; no historical payment values are changed.';

revoke all on public.legacy_payment_category_audit from public, anon;
grant select on public.legacy_payment_category_audit to authenticated;
