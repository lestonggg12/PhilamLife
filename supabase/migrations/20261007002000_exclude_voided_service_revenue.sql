-- Service revenue represents cash collected. Partial payments count for the
-- amount received; voided service receipts do not count anywhere.
create or replace function public.service_revenue_summary()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'total_collected', coalesce(sum(amount_paid), 0),
    'collected_this_month', coalesce(sum(amount_paid) filter (
      where (paid_at at time zone 'Asia/Manila') >= date_trunc('month', now() at time zone 'Asia/Manila')
    ), 0),
    'by_service', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount) order by s.amount desc, s.name)
      from (
        select coalesce(service_name, 'Uncategorized') as name, sum(amount_paid) as amount
        from public.service_transactions
        where lower(coalesce(payment_status, 'paid')) <> 'voided'
        group by 1
      ) s
    ), '[]'::jsonb)
  )
  from public.service_transactions
  where lower(coalesce(payment_status, 'paid')) <> 'voided';
$$;

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
    and lower(coalesce(payment_status, 'paid')) <> 'voided'
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
  'payment'::text, p.id::text, coalesce(p.receipt_number, ''), p.paid_at,
  coalesce(p.homeowner_name, ''), coalesce(p.block_name, ''), coalesce(p.lot_number, ''),
  concat_ws(', ', nullif(p.block_name, ''), nullif(p.lot_number, '')),
  coalesce(p.coverage_period, ''), coalesce(p.amount_paid, p.amount, 0),
  coalesce(p.payment_method, ''), coalesce(p.reference_number, ''),
  coalesce(p.recorded_by_name, ''), (coalesce(p.status, '') = 'Voided')
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
  coalesce(s.recorded_by_name, ''), lower(coalesce(s.payment_status, 'paid')) = 'voided'
from public.service_transactions s;

create or replace function public.receipts_period_summary(p_from timestamptz, p_to timestamptz)
returns table (
  payment_count integer, completed_count integer, voided_count integer,
  homeowners_served integer, dues_collected numeric,
  service_count integer, service_collected numeric
)
language sql stable security invoker set search_path = public as $$
  with p as (
    select count(*)::int as payment_count,
      (count(*) filter (where status is distinct from 'Voided'))::int as completed_count,
      (count(*) filter (where status = 'Voided'))::int as voided_count,
      (count(distinct coalesce(property_id::text, block_name || '-' || lot_number)
        ) filter (where status is distinct from 'Voided'))::int as homeowners_served,
      coalesce(sum(coalesce(amount_paid, amount, 0))
        filter (where status is distinct from 'Voided'), 0) as dues_collected
    from public.payments where paid_at >= p_from and paid_at < p_to
  ),
  s as (
    select count(*) filter (where lower(coalesce(payment_status, 'paid')) <> 'voided')::int as service_count,
      coalesce(sum(coalesce(amount_paid, 0))
        filter (where lower(coalesce(payment_status, 'paid')) <> 'voided'), 0) as service_collected
    from public.service_transactions where paid_at >= p_from and paid_at < p_to
  )
  select p.payment_count, p.completed_count, p.voided_count, p.homeowners_served,
    p.dues_collected, s.service_count, s.service_collected from p, s;
$$;

create or replace function public.receipt_active_days(
  p_month date,
  p_include_services boolean default true
)
returns setof date
language sql stable security invoker set search_path = public as $$
  select d from (
    select (timezone('Asia/Manila', paid_at))::date as d
    from public.payments
    where paid_at >= (date_trunc('month', p_month::timestamp) at time zone 'Asia/Manila')
      and paid_at < ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Asia/Manila')
    union
    select (timezone('Asia/Manila', paid_at))::date
    from public.service_transactions
    where p_include_services
      and lower(coalesce(payment_status, 'paid')) <> 'voided'
      and paid_at >= (date_trunc('month', p_month::timestamp) at time zone 'Asia/Manila')
      and paid_at < ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone 'Asia/Manila')
  ) days
  order by d;
$$;
