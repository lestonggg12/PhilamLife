-- Treasurer audit 1-6. Read-model correction + mandatory future expense audit.
-- Installation does not update historical financial rows, balances or penalties.
begin;
set local lock_timeout='5s';

-- Preserve the original seven columns/types; append dated aging buckets.
create or replace view public.property_overdue_summary
with (security_invoker=true) as
with settings as (
 select least(greatest(coalesce(due_day,5),1),31)::integer as due_day,
   greatest(coalesce(grace_period_days,0),0)::integer as grace_days,
   coalesce(late_penalty,0)::numeric as late_penalty
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
   (coalesce(t.dates_known,true) and abs(coalesce(t.allocated,0)-greatest(coalesce(p.current_balance,0),0))<=0.005) as aging_complete,
   s.late_penalty
 from public.properties p cross join settings s left join totals t on t.property_id=p.id
), priced as (
 select j.*,case when overdue_amount>0.005 and not exists(
   select 1 from public.property_charges c where c.property_id=j.property_id and c.voided_at is null
    and c.charge_type='Penalty / Late Fee' and c.created_at>=j.oldest_overdue_date
 ) then j.late_penalty else 0::numeric end as penalty_amount
 from joined j
)
select property_id,balance,overdue_amount,overdue_amount>0.005 as is_overdue,days_overdue,
 penalty_amount,(balance+penalty_amount)::numeric as total_due,
 current_amount,days_1_30_amount,days_31_60_amount,days_61_90_amount,days_90_plus_amount,
 aging_date_fallback_count,aging_complete
from priced;
revoke all on public.property_overdue_summary from anon;
grant select on public.property_overdue_summary to authenticated;

-- Add nullable cancellation metadata; old cancellations remain explicitly unknown.
alter table public.expenses
 add column if not exists voided_at timestamptz,
 add column if not exists voided_by uuid references public.profiles(id) on delete restrict,
 add column if not exists voided_by_name text,
 add column if not exists void_reason text;
create index if not exists expenses_voided_by_idx on public.expenses(voided_by);
do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.expenses'::regclass and conname='expenses_void_metadata_consistent') then
  alter table public.expenses add constraint expenses_void_metadata_consistent check(
   (voided_at is null and voided_by is null and voided_by_name is null and void_reason is null)
   or (status='Voided' and voided_at is not null and voided_by is not null
    and nullif(btrim(voided_by_name),'') is not null and void_reason is not null and length(btrim(void_reason)) between 5 and 500)
  );
 end if;
end$$;

create or replace function public.prepare_expense_record()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'')<>'treasurer' then
  raise exception using errcode='42501',message='An active Treasurer account is required to record an expense.';
 end if;
 if new.amount is null or new.amount<=0 or new.amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) then
  raise exception using errcode='22023',message='Enter a finite expense amount greater than zero.';
 end if;
 new.recorded_by:=auth.uid();
 select coalesce(nullif(btrim(full_name),''),email,'Treasurer') into new.recorded_by_name from public.profiles where id=auth.uid();
 new.created_at:=now();new.status:='Completed';
 new.voided_at:=null;new.voided_by:=null;new.voided_by_name:=null;new.void_reason:=null;
 return new;
end;
$$;
revoke all on function public.prepare_expense_record() from public,anon,authenticated;
create or replace trigger prepare_expense_record before insert on public.expenses
 for each row execute function public.prepare_expense_record();

create or replace function public.protect_expense_audit_fields()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'')<>'treasurer' then
  raise exception using errcode='42501',message='Only an active Treasurer can void expenses.';
 end if;
 if old.status='Voided' then raise exception 'This expense is already voided.'; end if;
 if new.status is distinct from 'Voided' then raise exception 'Expenses cannot be edited. Void the original with a reason and record a correction.'; end if;
 new.void_reason:=btrim(new.void_reason);
 if new.void_reason is null or length(new.void_reason) not between 5 and 500 then
  raise exception using errcode='22023',message='Enter a cancellation reason of 5 to 500 characters.';
 end if;
 new.id:=old.id;new.expense_date:=old.expense_date;new.category:=old.category;
 new.description:=old.description;new.amount:=old.amount;new.reference_number:=old.reference_number;
 new.recorded_by:=old.recorded_by;new.recorded_by_name:=old.recorded_by_name;new.created_at:=old.created_at;
 new.voided_at:=now();new.voided_by:=auth.uid();
 select coalesce(nullif(btrim(full_name),''),email,'Treasurer') into new.voided_by_name from public.profiles where id=auth.uid();
 return new;
end;
$$;
revoke all on function public.protect_expense_audit_fields() from public,anon,authenticated;

create or replace function public.audit_expense_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_text text;
begin
 target_text:=new.category||' — ₱'||to_char(new.amount,'FM999,999,999,990.00')||' ('||coalesce(new.voided_by_name,new.recorded_by_name)||') [Expense: '||new.id::text||']';
 if tg_op='INSERT' then
  perform public.write_required_balance_audit('Expense Recorded',target_text||' — '||new.description);
 elsif old.status is distinct from 'Voided' and new.status='Voided' then
  perform public.write_required_balance_audit('Expense Voided',target_text||' — '||new.void_reason);
 end if;
 return new;
end;
$$;
revoke all on function public.audit_expense_change() from public,anon,authenticated;
create or replace trigger audit_expense_change after insert or update of status on public.expenses
 for each row execute function public.audit_expense_change();

CREATE OR REPLACE FUNCTION public.dedupe_client_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if coalesce(current_setting('app.audit_trigger', true), 'off') = 'on' or auth.uid() is null then
    return new;
  end if;
  if new.action = 'Balance Added' and exists (
    select 1 from public.activity_log a
    where a.user_id = new.user_id and a.action = new.action
      and a.created_at > now() - interval '2 minutes'
      and strpos(a.target, new.target || ' [Balance entry: ') = 1
  ) then
    return null;
  end if;
  if new.action in ('Payment Recorded', 'Payment Voided', 'Charge Added', 'Charge Voided',
                    'Service Payment Recorded', 'Service Balance Collected') and exists (
    select 1 from public.activity_log a
    where a.user_id = new.user_id and a.action = new.action
      and a.created_at > now() - interval '2 minutes'
      and split_part(a.target, ' — ', 1) = split_part(new.target, ' — ', 1)
      and (new.action not like 'Charge%' or split_part(a.target, ' — ', 2) = split_part(new.target, ' — ', 2))
  ) then
    return null;
  end if;
  if new.action in ('Expense Recorded','Expense Voided') and exists (
    select 1 from public.activity_log a where a.user_id=new.user_id and a.action=new.action
      and a.created_at>now()-interval '2 minutes'
      and strpos(a.target,new.target||' [Expense: ')=1
  ) then return null; end if;
  return new;
end;
$function$;
revoke all on function public.dedupe_client_audit() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
