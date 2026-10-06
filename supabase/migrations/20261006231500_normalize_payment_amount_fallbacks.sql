-- Keep reporting views consistent with payment normalization:
-- amount_paid is preferred, with amount as the legacy fallback.
create or replace view public.property_payment_summary
with (security_invoker = true) as
with active as (
  select * from public.payments
  where property_id is not null and status is distinct from 'Voided'
),
latest as (
  select distinct on (property_id)
         property_id, paid_at, previous_balance,
         coalesce(amount_paid, amount)::numeric(12,2) as amount_paid,
         remaining_balance
  from active
  order by property_id, paid_at desc, id asc
),
totals as (
  select property_id,
         count(*)::int as active_payment_count,
         coalesce(sum(coalesce(amount_paid, amount)), 0) as total_paid
  from active
  group by property_id
)
select t.property_id,
       t.active_payment_count,
       t.total_paid,
       l.paid_at           as latest_paid_at,
       l.previous_balance  as latest_previous_balance,
       l.amount_paid       as latest_amount_paid,
       l.remaining_balance as latest_remaining_balance
from totals t
join latest l using (property_id);

create or replace view public.monthly_collections
with (security_invoker = true) as
with dues as (
  select date_trunc('month', paid_at at time zone 'Asia/Manila')::date as month_start,
         coalesce(sum(coalesce(amount_paid, amount)), 0) as dues_collected,
         count(*)::int as dues_receipts
  from public.payments
  where status is distinct from 'Voided' and paid_at is not null
  group by 1
),
svc as (
  select date_trunc('month', paid_at at time zone 'Asia/Manila')::date as month_start,
         coalesce(sum(coalesce(amount_paid, 0)), 0) as service_collected,
         count(*)::int as service_receipts
  from public.service_transactions
  where paid_at is not null
  group by 1
)
select coalesce(d.month_start, s.month_start) as month_start,
       coalesce(d.dues_collected, 0) as dues_collected,
       coalesce(d.dues_receipts, 0) as dues_receipts,
       coalesce(s.service_collected, 0) as service_collected,
       coalesce(s.service_receipts, 0) as service_receipts
from dues d
full outer join svc s on d.month_start = s.month_start;

create or replace view public.official_receipts_feed
with (security_invoker = true) as
select
  'payment'::text as kind,
  p.id::text as source_id,
  coalesce(p.receipt_number, '') as receipt_number,
  p.paid_at,
  coalesce(p.homeowner_name, '') as payer,
  coalesce(p.block_name, '') as block_name,
  coalesce(p.lot_number, '') as lot_number,
  concat_ws(', ', nullif(p.block_name, ''), nullif(p.lot_number, '')) as property_label,
  coalesce(p.coverage_period, '') as description,
  coalesce(p.amount_paid, p.amount, 0) as amount_paid,
  coalesce(p.payment_method, '') as payment_method,
  coalesce(p.reference_number, '') as reference_number,
  coalesce(p.recorded_by_name, '') as recorded_by_name,
  (coalesce(p.status, '') = 'Voided') as is_voided
from public.payments p
union all
select
  'service'::text, s.id::text, coalesce(s.receipt_number, ''), s.paid_at,
  coalesce(s.customer_name, ''), coalesce(s.block_name, ''), coalesce(s.lot_number, ''),
  concat_ws(', ', nullif(s.block_name, ''),
    case when nullif(s.lot_number, '') is null then null
         when s.lot_number ~* '^lot\s' then s.lot_number
         else 'Lot ' || s.lot_number end),
  coalesce(s.service_name, ''), coalesce(s.amount_paid, 0),
  coalesce(s.payment_method, ''), coalesce(s.reference_number, ''),
  coalesce(s.recorded_by_name, ''), false
from public.service_transactions s;
