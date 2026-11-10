-- CCTV electricity compensation is a monthly non-cash billing credit, not a
-- payment discount. It applies whether or not the homeowner has paid.
-- Admins select an effective month, including months already billed.
create table public.cctv_electricity_schedules (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  monthly_credit numeric(12,2) not null check (monthly_credit > 0 and monthly_credit <= 100000),
  starts_on date not null,
  ends_before date,
  reason text not null check (length(btrim(reason)) >= 5),
  approved_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint cctv_start_is_month check (starts_on = date_trunc('month',starts_on)::date),
  constraint cctv_end_is_month check (ends_before is null or ends_before = date_trunc('month',ends_before)::date),
  constraint cctv_positive_interval check (ends_before is null or ends_before > starts_on)
);
create index cctv_electricity_schedules_property_idx
  on public.cctv_electricity_schedules(property_id, starts_on);
alter table public.cctv_electricity_schedules enable row level security;
create policy "Staff view CCTV electricity schedules" on public.cctv_electricity_schedules
  for select to authenticated using (public.current_user_role() in ('admin','secretary','treasurer'));
revoke all on public.cctv_electricity_schedules from public, anon;
grant select on public.cctv_electricity_schedules to authenticated;

-- Only one active credit can exist for any monthly dues charge. Reversals
-- remain available for the audit trail, including after a charge is restored.
create unique index cctv_one_active_credit_per_charge
  on public.account_adjustments(charge_id)
  where approval_reference like 'CCTV:%' and reversed_at is null;

create or replace function public.post_cctv_credit_for_charge(p_charge_id uuid)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_charge public.property_charges%rowtype;
  v_schedule public.cctv_electricity_schedules%rowtype;
  v_credit numeric(12,2);
begin
  select * into v_charge from public.property_charges
    where id = p_charge_id for update;
  if not found or v_charge.charge_type <> 'Association Dues' or
     v_charge.billing_month is null or v_charge.voided_at is not null then
    return;
  end if;
  if exists (select 1 from public.account_adjustments
    where charge_id=v_charge.id and approval_reference like 'CCTV:%' and reversed_at is null) then
    return;
  end if;
  select * into v_schedule from public.cctv_electricity_schedules s
    where s.property_id = v_charge.property_id
      and v_charge.billing_month >= s.starts_on
      and (s.ends_before is null or v_charge.billing_month < s.ends_before)
    order by s.starts_on desc limit 1;
  if not found then return; end if;
  v_credit := least(v_schedule.monthly_credit, v_charge.amount);
  if v_credit <= 0 then return; end if;
  insert into public.account_adjustments
    (property_id,charge_id,adjustment_type,balance_effect,reason,approval_reference,created_by)
  values (v_charge.property_id,v_charge.id,'credit',-v_credit,
    'CCTV electricity compensation for '||to_char(v_charge.billing_month,'FMMonth YYYY')||
       ' ('||v_schedule.reason||')',
    'CCTV:'||v_charge.id::text||':'||v_schedule.id::text, v_schedule.approved_by);
end;
$function$;
revoke all on function public.post_cctv_credit_for_charge(uuid) from public,anon,authenticated;

create or replace function public.sync_cctv_electricity_credit()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='INSERT' then
    perform public.post_cctv_credit_for_charge(new.id);
  elsif old.voided_at is null and new.voided_at is not null then
    update public.account_adjustments
      set reversed_at=now(),reversed_by=auth.uid(),
          reversal_reason='Monthly association dues charge voided'
    where charge_id=new.id and approval_reference like 'CCTV:%' and reversed_at is null;
  elsif old.voided_at is not null and new.voided_at is null then
    perform public.post_cctv_credit_for_charge(new.id);
  end if;
  return new;
end;
$function$;
create trigger zz_cctv_electricity_charge
  after insert or update of voided_at on public.property_charges
  for each row execute function public.sync_cctv_electricity_credit();

-- The normal discount adjustment trigger only processes PAYDISC references.
-- The CCTV credit must update the homeowner balance independently.
create or replace function public.apply_cctv_electricity_credit()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.adjustment_type <> 'credit' or new.approval_reference not like 'CCTV:%' then
    return new;
  end if;
  if tg_op='INSERT' then
    update public.properties set current_balance=current_balance+new.balance_effect
      where id=new.property_id;
  elsif old.reversed_at is null and new.reversed_at is not null then
    update public.properties set current_balance=current_balance-old.balance_effect
      where id=new.property_id;
  end if;
  return new;
end;
$function$;
create trigger zz_cctv_electricity_balance
  after insert or update of reversed_at on public.account_adjustments
  for each row execute function public.apply_cctv_electricity_credit();

create or replace function public.create_cctv_electricity_schedule(
  p_property_id bigint, p_monthly_credit numeric, p_start_month date,
  p_end_month date, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_id uuid;
  v_end_before date;
  v_charge record;
begin
  if auth.uid() is null or public.current_user_role() <> 'admin' then
    raise exception using errcode='42501', message='Only Admin can approve CCTV electricity compensation.';
  end if;
  if p_property_id is null or p_monthly_credit is null or
     p_monthly_credit <= 0 or p_monthly_credit > 100000 or
     p_monthly_credit <> round(p_monthly_credit,2) or p_start_month is null or
     p_start_month <> date_trunc('month',p_start_month)::date or
     (p_end_month is not null and
       (p_end_month <> date_trunc('month',p_end_month)::date or p_end_month < p_start_month)) or
     length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception using errcode='22023', message='Enter a valid credit, starting month and reason.';
  end if;
  v_end_before := (p_end_month + interval '1 month')::date;
  -- Lock the property, matching the dues billing lock, so concurrent schedule
  -- creation and monthly billing cannot post two credits or miss a credit.
  perform 1 from public.properties where id=p_property_id
    and homeowner_status='active' for update;
  if not found then
    raise exception using errcode='22023',message='Select an active homeowner lot.';
  end if;
  if exists (select 1 from public.cctv_electricity_schedules s
    where s.property_id=p_property_id and s.starts_on < coalesce(v_end_before,'infinity'::date)
      and p_start_month < coalesce(s.ends_before,'infinity'::date)) then
    raise exception using errcode='23505',message='CCTV compensation months overlap an existing schedule.';
  end if;
  if exists (select 1 from public.financial_invariant_report f
    where f.property_id=p_property_id and abs(f.reconciliation_difference)>0.005) then
    raise exception 'Property balance is unreconciled; no credits posted.';
  end if;
  insert into public.cctv_electricity_schedules
    (property_id,monthly_credit,starts_on,ends_before,reason,approved_by)
  values (p_property_id,p_monthly_credit,p_start_month,v_end_before,btrim(p_reason),auth.uid())
  returning id into v_id;
  -- Retroactively credit only monthly dues charges that were actually issued.
  -- Do not overwrite previous billing amounts or payment receipts.
  for v_charge in
    select id from public.property_charges
    where property_id=p_property_id and charge_type='Association Dues'
      and billing_month >= p_start_month
      and (v_end_before is null or billing_month < v_end_before)
      and voided_at is null order by billing_month,id
  loop
    perform public.post_cctv_credit_for_charge(v_charge.id);
  end loop;
  if exists (select 1 from public.financial_invariant_report f
    where f.property_id=p_property_id and abs(f.reconciliation_difference)>0.005) then
    raise exception 'CCTV credit reconciliation failed; all changes rolled back.';
  end if;
  perform public.write_audit_log('CCTV Electricity Compensation',
    format('Property %s / PHP %s per month / from %s through %s / schedule %s / admin %s',
      p_property_id,p_monthly_credit,p_start_month,coalesce(p_end_month::text,'open ended'),v_id,auth.uid()));
  return v_id;
end;
$function$;
revoke all on function public.create_cctv_electricity_schedule(bigint,numeric,date,date,text)
  from public,anon;
grant execute on function public.create_cctv_electricity_schedule(bigint,numeric,date,date,text)
  to authenticated;
