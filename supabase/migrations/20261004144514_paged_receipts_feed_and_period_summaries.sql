-- Support for server-side paging on the Payments and Official Receipts pages.
-- The browser asks for 50 rows at a time plus a few totals, instead of downloading
-- every payment and service receipt ever recorded.

-- 1) One list of every receipt (regular payments + service payments).
--    security_invoker = true  ->  the viewer's own Row Level Security applies.
create or replace view public.official_receipts_feed
with (security_invoker = true) as
select
  'payment'::text                                   as kind,
  p.id::text                                        as source_id,
  coalesce(p.receipt_number, '')                    as receipt_number,
  p.paid_at,
  coalesce(p.homeowner_name, '')                    as payer,
  coalesce(p.block_name, '')                        as block_name,
  coalesce(p.lot_number, '')                        as lot_number,
  concat_ws(', ', nullif(p.block_name, ''), nullif(p.lot_number, '')) as property_label,
  coalesce(p.coverage_period, '')                   as description,
  coalesce(p.amount_paid, 0)                        as amount_paid,
  coalesce(p.payment_method, '')                    as payment_method,
  coalesce(p.reference_number, '')                  as reference_number,
  coalesce(p.recorded_by_name, '')                  as recorded_by_name,
  (coalesce(p.status, '') = 'Voided')               as is_voided
from public.payments p
union all
select
  'service'::text,
  s.id::text,
  coalesce(s.receipt_number, ''),
  s.paid_at,
  coalesce(s.customer_name, ''),
  coalesce(s.block_name, ''),
  coalesce(s.lot_number, ''),
  concat_ws(', ',
    nullif(s.block_name, ''),
    case
      when nullif(s.lot_number, '') is null then null
      when s.lot_number ~* '^lot\s' then s.lot_number
      else 'Lot ' || s.lot_number
    end),
  coalesce(s.service_name, ''),
  coalesce(s.amount_paid, 0),
  coalesce(s.payment_method, ''),
  coalesce(s.reference_number, ''),
  coalesce(s.recorded_by_name, ''),
  false
from public.service_transactions s;

revoke all on public.official_receipts_feed from public, anon;
grant select on public.official_receipts_feed to authenticated;

-- 2) Totals for a period: p_from inclusive, p_to exclusive.
create or replace function public.receipts_period_summary(p_from timestamptz, p_to timestamptz)
returns table (
  payment_count      integer,
  completed_count    integer,
  voided_count       integer,
  homeowners_served  integer,
  dues_collected     numeric,
  service_count      integer,
  service_collected  numeric
)
language sql stable security invoker set search_path = public as $$
  with p as (
    select
      count(*)::int                                                  as payment_count,
      (count(*) filter (where status is distinct from 'Voided'))::int as completed_count,
      (count(*) filter (where status = 'Voided'))::int                as voided_count,
      (count(distinct coalesce(property_id::text, block_name || '-' || lot_number))
         filter (where status is distinct from 'Voided'))::int        as homeowners_served,
      coalesce(sum(coalesce(amount_paid, amount, 0))
         filter (where status is distinct from 'Voided'), 0)          as dues_collected
    from public.payments
    where paid_at >= p_from and paid_at < p_to
  ),
  s as (
    select count(*)::int as service_count,
           coalesce(sum(coalesce(amount_paid, 0)), 0) as service_collected
    from public.service_transactions
    where paid_at >= p_from and paid_at < p_to
  )
  select p.payment_count, p.completed_count, p.voided_count, p.homeowners_served,
         p.dues_collected, s.service_count, s.service_collected
  from p, s;
$$;

revoke all on function public.receipts_period_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.receipts_period_summary(timestamptz, timestamptz) to authenticated;

-- 3) Which days (Manila time) of a month have receipts - for the calendar dots.
create or replace function public.receipt_active_days(p_month date, p_include_services boolean default true)
returns setof date
language sql stable security invoker set search_path = public as $$
  select d from (
    select (timezone('Asia/Manila', paid_at))::date as d
    from public.payments
    where paid_at >= (date_trunc('month', p_month::timestamp) at time zone 'Asia/Manila')
      and paid_at <  ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Asia/Manila')
    union
    select (timezone('Asia/Manila', paid_at))::date
    from public.service_transactions
    where p_include_services
      and paid_at >= (date_trunc('month', p_month::timestamp) at time zone 'Asia/Manila')
      and paid_at <  ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Asia/Manila')
  ) days
  order by d;
$$;

revoke all on function public.receipt_active_days(date, boolean) from public, anon;
grant execute on function public.receipt_active_days(date, boolean) to authenticated;
