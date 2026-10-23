-- QA-004: both views scanned every payment on each call (about 0.8 s at 50,000 payments, growing with lifetime volume)
-- even when the app filtered to one month or one homeowner. Same columns and same results, rewritten so that filters
-- are applied per month / per property using the existing indexes. Verified row-for-row against the old definitions
-- on the live data and on a synthetic 50,000-payment dataset (rolled back) before this migration.
-- Measured at 50,000 payments: monthly_collections one month 796 ms -> 71 ms; property_payment_summary one property 750 ms -> 1.4 ms.

drop view if exists public.monthly_collections;
create view public.monthly_collections with (security_invoker = true) as
select b.month_start,
  coalesce(d.dues_collected, 0::numeric) as dues_collected,
  coalesce(d.dues_receipts, 0) as dues_receipts,
  coalesce(s.service_collected, 0::numeric) as service_collected,
  coalesce(s.service_receipts, 0) as service_receipts,
  coalesce(d.dues_only_collected, 0::numeric) as dues_only_collected,
  coalesce(d.dues_only_receipts, 0) as dues_only_receipts,
  coalesce(d.fees_collected, 0::numeric) as fees_collected,
  coalesce(d.fees_receipts, 0) as fees_receipts
from (
  select m::date as month_start,
         (m::timestamp at time zone 'Asia/Manila') as lo,
         ((m + interval '1 month')::timestamp at time zone 'Asia/Manila') as hi
  from generate_series(
    (select date_trunc('month', least((select min(paid_at) from public.payments), (select min(paid_at) from public.service_transactions)) at time zone 'Asia/Manila'))::date,
    (select date_trunc('month', greatest((select max(paid_at) from public.payments), (select max(paid_at) from public.service_transactions)) at time zone 'Asia/Manila'))::date,
    interval '1 month') m
) b
cross join lateral (
  select coalesce(sum(coalesce(x.amount_paid, x.amount)), 0::numeric) as dues_collected,
         (count(*))::integer as dues_receipts,
         coalesce(sum(coalesce(x.amount_paid, x.amount)) filter (where coalesce(x.charge_type, 'Association Dues') = 'Association Dues'), 0::numeric) as dues_only_collected,
         (count(*) filter (where coalesce(x.charge_type, 'Association Dues') = 'Association Dues'))::integer as dues_only_receipts,
         coalesce(sum(coalesce(x.amount_paid, x.amount)) filter (where coalesce(x.charge_type, 'Association Dues') <> 'Association Dues'), 0::numeric) as fees_collected,
         (count(*) filter (where coalesce(x.charge_type, 'Association Dues') <> 'Association Dues'))::integer as fees_receipts
  from public.payments x
  where x.status is distinct from 'Voided' and x.paid_at >= b.lo and x.paid_at < b.hi
) d
cross join lateral (
  select coalesce(sum(coalesce(t.amount_paid, 0::numeric)), 0::numeric) as service_collected,
         (count(*))::integer as service_receipts
  from public.service_transactions t
  where lower(coalesce(t.payment_status, 'paid')) <> 'voided' and t.paid_at >= b.lo and t.paid_at < b.hi
) s
where d.dues_receipts > 0 or s.service_receipts > 0;

drop view if exists public.property_payment_summary;
create view public.property_payment_summary with (security_invoker = true) as
select p.id as property_id,
       s.active_payment_count,
       s.total_paid,
       s.latest_paid_at,
       s.latest_previous_balance,
       s.latest_amount_paid,
       s.latest_remaining_balance
from public.properties p
cross join lateral (
  select (count(*))::integer as active_payment_count,
         coalesce(sum(coalesce(x.amount_paid, x.amount)), 0::numeric) as total_paid,
         (array_agg(x.paid_at order by x.paid_at desc, x.id))[1] as latest_paid_at,
         ((array_agg(x.previous_balance order by x.paid_at desc, x.id))[1])::numeric(12,2) as latest_previous_balance,
         ((array_agg(coalesce(x.amount_paid, x.amount) order by x.paid_at desc, x.id))[1])::numeric(12,2) as latest_amount_paid,
         ((array_agg(x.remaining_balance order by x.paid_at desc, x.id))[1])::numeric(12,2) as latest_remaining_balance
  from public.payments x
  where x.property_id = p.id and x.status is distinct from 'Voided'
  having count(*) > 0
) s;

revoke all on public.monthly_collections, public.property_payment_summary from anon, public;
grant select on public.monthly_collections, public.property_payment_summary to authenticated, service_role;