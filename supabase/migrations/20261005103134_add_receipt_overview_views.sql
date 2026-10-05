-- Totals and calendar dots for the Payments and Official Receipts pages, computed in
-- the database so those pages no longer download every receipt just to show a few numbers.

create or replace view public.payments_overview
with (security_invoker = true) as
select coalesce(sum(coalesce(amount_paid, amount, 0)), 0) as collected,
       count(*)::int as completed_count,
       count(distinct property_id)::int as homeowner_count
from public.payments
where status is distinct from 'Voided';

create or replace view public.receipts_overview
with (security_invoker = true) as
select count(*)::int as total_count,
       count(*) filter (where kind = 'payment')::int as payment_count,
       count(*) filter (where kind = 'service')::int as service_count,
       coalesce(sum(amount_paid) filter (where not is_voided), 0) as collected
from public.official_receipts_feed;

create or replace view public.receipt_active_dates
with (security_invoker = true) as
select distinct kind, (paid_at at time zone 'Asia/Manila')::date as day
from public.official_receipts_feed
where paid_at is not null;

revoke all on public.payments_overview, public.receipts_overview, public.receipt_active_dates from anon;
grant select on public.payments_overview, public.receipts_overview, public.receipt_active_dates to authenticated;