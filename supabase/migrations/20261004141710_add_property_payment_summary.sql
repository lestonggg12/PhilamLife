-- Per-homeowner payment totals computed in the database so the browser no longer
-- downloads the whole payments table just to show balances and last payments.
create index if not exists payments_property_paid_at_idx
  on public.payments (property_id, paid_at desc, id);

create or replace view public.property_payment_summary
with (security_invoker = true) as
with active as (
  select * from public.payments
  where property_id is not null and status is distinct from 'Voided'
),
latest as (
  select distinct on (property_id)
         property_id, paid_at, previous_balance, amount_paid, remaining_balance
  from active
  order by property_id, paid_at desc, id asc
),
totals as (
  select property_id,
         count(*)::int as active_payment_count,
         coalesce(sum(coalesce(amount_paid, 0)), 0) as total_paid
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

revoke all on public.property_payment_summary from anon;
grant select on public.property_payment_summary to authenticated;