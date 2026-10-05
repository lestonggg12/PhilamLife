-- Monthly collection totals (Manila time) computed in the database so dashboards
-- receive ~1 row per month instead of downloading every payment.
create index if not exists service_transactions_paid_at_idx2
  on public.service_transactions (paid_at desc);

create or replace view public.monthly_collections
with (security_invoker = true) as
with dues as (
  select date_trunc('month', paid_at at time zone 'Asia/Manila')::date as month_start,
         coalesce(sum(coalesce(amount_paid, 0)), 0) as dues_collected,
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
       coalesce(d.dues_collected, 0)    as dues_collected,
       coalesce(d.dues_receipts, 0)     as dues_receipts,
       coalesce(s.service_collected, 0) as service_collected,
       coalesce(s.service_receipts, 0)  as service_receipts
from dues d
full outer join svc s on d.month_start = s.month_start;

revoke all on public.monthly_collections from anon;
grant select on public.monthly_collections to authenticated;