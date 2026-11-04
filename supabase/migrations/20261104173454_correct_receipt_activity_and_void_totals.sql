-- Receipt summaries and calendar corrections.
-- Already applied to Supabase as migration 20261104173454.
-- No existing receipts or paper numbers are modified.
create or replace function public.receipt_active_days(p_month date, p_include_services boolean default true)
returns setof date
language sql
stable
set search_path to 'public'
as $function$
  select d from (
    select (timezone('Asia/Manila', paid_at))::date as d
    from public.payments
    where status is distinct from 'Voided'
      and paid_at >= (date_trunc('month', p_month::timestamp) at time zone 'Asia/Manila')
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
$function$;

create or replace function public.receipts_period_summary(p_from timestamp with time zone, p_to timestamp with time zone)
returns table(payment_count integer, completed_count integer, voided_count integer, homeowners_served integer, dues_collected numeric, service_count integer, service_collected numeric)
language sql
stable
set search_path to 'public'
as $function$
  with p as (
    select count(*)::int as payment_count,
      (count(*) filter (where status is distinct from 'Voided'))::int as completed_count,
      (count(*) filter (where status = 'Voided'))::int as homeowner_voided_count,
      (count(distinct coalesce(property_id::text, block_name || '-' || lot_number))
        filter (where status is distinct from 'Voided'))::int as homeowners_served,
      coalesce(sum(coalesce(amount_paid, amount, 0))
        filter (where status is distinct from 'Voided'), 0) as dues_collected
    from public.payments where paid_at >= p_from and paid_at < p_to
  ),
  s as (
    select (count(*) filter (where lower(coalesce(payment_status,'paid')) <> 'voided'))::int as service_count,
      (count(*) filter (where lower(coalesce(payment_status,'paid')) = 'voided'))::int as service_voided_count,
      coalesce(sum(coalesce(amount_paid, 0))
        filter (where lower(coalesce(payment_status,'paid')) <> 'voided'), 0) as service_collected
    from public.service_transactions where paid_at >= p_from and paid_at < p_to
  )
  select p.payment_count, p.completed_count,
    (p.homeowner_voided_count + s.service_voided_count)::int as voided_count,
    p.homeowners_served, p.dues_collected, s.service_count, s.service_collected
  from p cross join s;
$function$;
