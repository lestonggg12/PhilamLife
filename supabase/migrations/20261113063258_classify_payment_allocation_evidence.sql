-- Classify legacy allocation warnings without modifying receipts or linking charges.
-- Synthetic fixture markers are explicitly retained as test data; newer system
-- snapshots count as evidence only when their recorded totals reconcile.

create or replace view public.payment_allocation_audit_status
with (security_invoker = true) as
with item_totals as (
  select payment_id, sum(applied_amount) as allocated_to_items
  from public.payment_application_item_snapshots
  group by payment_id
)
select
  g.payment_id,
  g.receipt_number,
  g.property_id,
  g.paid_at,
  g.cash_received,
  g.applied_effect,
  g.explicit_allocated_amount,
  g.inferred_amount,
  case
    when coalesce(p.note, '') ilike '%synthetic%'
      or coalesce(p.receipt_breakdown::text, '') ilike '%synthetic fixture%'
      then 'synthetic_fixture'
    when s.payment_id is not null
      and s.property_id = g.property_id
      and abs(s.cash_received - g.cash_received) <= 0.005
      and abs(s.recorded_balance_effect - g.applied_effect) <= 0.005
      and abs(s.applied_to_existing_items + s.unapplied_account_effect - s.recorded_balance_effect) <= 0.005
      and abs(coalesce(i.allocated_to_items, 0) - s.applied_to_existing_items) <= 0.005
      and abs(s.recorded_balance_effect - s.cash_received - s.noncash_annual_discount + s.cash_not_reducing_balance) <= 0.005
      then 'system_snapshot'
    else 'review_required'
  end as review_category
from public.payment_allocation_gaps g
join public.payments p on p.id = g.payment_id
left join public.payment_application_snapshots s on s.payment_id = g.payment_id
left join item_totals i on i.payment_id = g.payment_id;

comment on view public.payment_allocation_audit_status is
  'Read-only staff audit that separates synthetic fixtures, reconciled system snapshots, and older payment evidence needing review. No allocations are invented.';

revoke all on public.payment_allocation_audit_status from public, anon;
grant select on public.payment_allocation_audit_status to authenticated;

create or replace view public.payment_allocation_audit_summary
with (security_invoker = true) as
select
  count(*) filter (where review_category = 'review_required')::integer as review_required,
  count(*) filter (where review_category = 'synthetic_fixture')::integer as synthetic_fixture,
  count(*) filter (where review_category = 'system_snapshot')::integer as system_snapshot,
  count(*)::integer as total_flagged
from public.payment_allocation_audit_status;

comment on view public.payment_allocation_audit_summary is
  'Staff-only aggregate of classified payment-allocation evidence; does not change any financial record.';

revoke all on public.payment_allocation_audit_summary from public, anon;
grant select on public.payment_allocation_audit_summary to authenticated;
