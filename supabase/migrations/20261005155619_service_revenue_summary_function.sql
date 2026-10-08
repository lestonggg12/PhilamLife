-- Totals for the Service Revenue page, computed in the database so the page no longer
-- has to download every service receipt. Runs with the caller's permissions (RLS applies).
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
        group by 1
      ) s
    ), '[]'::jsonb)
  )
  from public.service_transactions;
$$;

revoke all on function public.service_revenue_summary() from public, anon;
grant execute on function public.service_revenue_summary() to authenticated;
