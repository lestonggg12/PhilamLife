-- Overdue Accounts read-model correction (no writes to financial records).
-- A proposed/future penalty is not an amount owed. Annual and late penalties
-- become collectible only after posting into property_charges/current_balance.
-- Preserve all 14 existing output columns, order and types for PostgREST.
begin;
set local lock_timeout = '5s';

create or replace view public.property_overdue_summary
with (security_invoker = true) as
with settings as (
 select least(greatest(coalesce(due_day,5),1),31)::integer as due_day,
   greatest(coalesce(grace_period_days,0),0)::integer as grace_days
 from public.system_settings where id=1
), clock as (select public.hoa_manila_today() as today), dated_items as (
 select i.property_id,i.unpaid,
   case when c.billing_month is not null then
     (date_trunc('month',c.billing_month)::date
       + least(s.due_day,extract(day from date_trunc('month',c.billing_month)+interval '1 month - 1 day')::integer)-1+s.grace_days)
   else coalesce(t.effective_date,i.item_date,p.opening_balance_as_of,
     (p.created_at at time zone 'Asia/Manila')::date)+s.grace_days end as deadline,
   (t.effective_date is null and i.item_date is null) as used_date_fallback
 from public.property_balance_items i join public.properties p on p.id=i.property_id
 cross join settings s
 left join public.property_charges c on c.id=i.ref_id and i.kind in ('dues','penalty','charge')
 left join public.account_adjustments a on a.id=i.ref_id and i.kind='adjustment'
 left join public.homeowner_balance_transfers t on t.id::text=a.approval_reference and t.new_property_id=i.property_id
 where i.unpaid>0
), ages as (
 select i.*,c.today-i.deadline as age from dated_items i cross join clock c
), totals as (
 select property_id,sum(unpaid) as allocated,bool_and(deadline is not null) as dates_known,
   coalesce(sum(unpaid) filter(where age<=0),0)::numeric as current_amount,
   coalesce(sum(unpaid) filter(where age between 1 and 30),0)::numeric as days_1_30_amount,
   coalesce(sum(unpaid) filter(where age between 31 and 60),0)::numeric as days_31_60_amount,
   coalesce(sum(unpaid) filter(where age between 61 and 90),0)::numeric as days_61_90_amount,
   coalesce(sum(unpaid) filter(where age>90),0)::numeric as days_90_plus_amount,
   coalesce(sum(unpaid) filter(where age>0),0)::numeric as overdue_amount,
   coalesce(max(age) filter(where age>0),0)::integer as days_overdue,
   min(deadline) filter(where age>0) as oldest_overdue_date,
   count(*) filter(where used_date_fallback)::integer as aging_date_fallback_count
 from ages group by property_id
), joined as (
 select p.id as property_id,greatest(coalesce(p.current_balance,0),0)::numeric as balance,
   coalesce(t.overdue_amount,0)::numeric as overdue_amount,
   coalesce(t.days_overdue,0)::integer as days_overdue,t.oldest_overdue_date,
   coalesce(t.current_amount,0)::numeric as current_amount,
   coalesce(t.days_1_30_amount,0)::numeric as days_1_30_amount,
   coalesce(t.days_31_60_amount,0)::numeric as days_31_60_amount,
   coalesce(t.days_61_90_amount,0)::numeric as days_61_90_amount,
   coalesce(t.days_90_plus_amount,0)::numeric as days_90_plus_amount,
   coalesce(t.aging_date_fallback_count,0)::integer as aging_date_fallback_count,
   (coalesce(t.dates_known,true) and abs(coalesce(t.allocated,0)-greatest(coalesce(p.current_balance,0),0))<=0.005) as aging_complete
 from public.properties p cross join settings s left join totals t on t.property_id=p.id
)
select property_id,balance,overdue_amount,overdue_amount>0.005 as is_overdue,days_overdue,
 0::numeric as penalty_amount,balance::numeric as total_due,
 current_amount,days_1_30_amount,days_31_60_amount,days_61_90_amount,days_90_plus_amount,
 aging_date_fallback_count,aging_complete
from joined;

revoke all on public.property_overdue_summary from anon;
grant select on public.property_overdue_summary to authenticated;
notify pgrst, 'reload schema';
commit;
