-- Phase 1: deploy BEFORE the updated client. Safe for old clients and historical data.
-- Manual charge due_date is the FINAL deadline (no additional Admin grace days).
-- NULL retains the existing historical calculation for previously entered charges.
begin;
set local lock_timeout = '5s';

alter table public.property_charges add column if not exists due_date date;
comment on column public.property_charges.due_date is
 'Final inclusive deadline for a manual charge; nullable for legacy and system charges. Overdue starts the next Manila calendar day.';

create or replace view public.property_overdue_summary
with (security_invoker = true) as
with settings as (
 select least(greatest(coalesce(due_day,5),1),31)::integer as due_day,
   greatest(coalesce(grace_period_days,0),0)::integer as grace_days
 from public.system_settings where id=1
), clock as (select public.hoa_manila_today() as today), dated_items as (
 select i.property_id,i.unpaid,
   case when c.due_date is not null and c.billing_month is null then c.due_date
   when c.billing_month is not null then
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

create or replace view public.property_payment_progress
with (security_invoker = true) as
with period_items as (
 select property_id, date_trunc('month', item_date::timestamp)::date as period,
   bool_or(unpaid > 0.005) as has_unpaid,
   bool_or(original - unpaid > 0.005) as has_applied_effect
 from public.property_balance_items
 where original > 0
 group by property_id, date_trunc('month', item_date::timestamp)::date
)
select property_id, bool_or(has_unpaid and has_applied_effect) as has_partial_payment
from period_items group by property_id;

revoke all on public.property_payment_progress from anon;
grant select on public.property_payment_progress to authenticated;
revoke all on public.property_overdue_summary from anon;
grant select on public.property_overdue_summary to authenticated;

create or replace function public.reject_charge_due_date_update()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
 if new.due_date is distinct from old.due_date then
   raise exception 'Charge due dates are immutable. Void the incorrect charge and enter a corrected charge with an audit reason.';
 end if;
 return new;
end;
$$;
revoke all on function public.reject_charge_due_date_update() from public, anon, authenticated;
drop trigger if exists reject_charge_due_date_update on public.property_charges;
create trigger reject_charge_due_date_update
before update of due_date on public.property_charges
for each row execute function public.reject_charge_due_date_update();

notify pgrst, 'reload schema';
commit;
