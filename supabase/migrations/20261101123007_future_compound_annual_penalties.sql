-- Future-only annual compounding. Historical money and receipt rows are untouched.
-- Requires the adjustment-aware balance views from High #1 (20261101123002).
begin;
do $$ begin
  if position('account_adjustments' in pg_get_viewdef('public.property_balance_items'::regclass,true)) = 0 then
    raise exception 'Install the High #1 adjustment-aware balance migration first.';
  end if;
end $$;

create table public.annual_penalty_policy (
  id integer primary key check(id=1),
  effective_date date not null,
  method text not null default 'annual_compound' check(method='annual_compound'),
  created_at timestamptz not null default now()
);
insert into public.annual_penalty_policy(id,effective_date)
values(1,greatest(date '2026-11-02', public.hoa_manila_today()+1));

create table public.annual_penalty_schedules (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  source_kind text not null check(source_kind in ('entry','dues','opening','adjustment','penalty')),
  source_ref uuid not null,
  as_of_date date not null,
  first_after_months integer not null check(first_after_months between 1 and 600),
  next_anniversary_no integer not null default 1 check(next_anniversary_no>=1),
  created_at timestamptz not null default now(),
  unique(property_id,source_kind,source_ref)
);
create table public.annual_penalty_assessments (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.annual_penalty_schedules(id) on delete restrict,
  property_id bigint not null references public.properties(id) on delete restrict,
  anniversary_no integer not null check(anniversary_no>=1),
  anniversary_date date not null,
  assessed_on date not null,
  base_amount numeric(12,2) not null check(base_amount>=0),
  rate numeric(6,4) not null check(rate between 0 and 1),
  penalty_amount numeric(12,2) not null check(penalty_amount>=0),
  charge_id uuid unique references public.property_charges(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete restrict,
  origin text not null check(origin in ('staff','scheduled_system')),
  posted_at timestamptz not null default now(),
  unique(schedule_id,anniversary_no),
  check((penalty_amount=0)=(charge_id is null)),
  check((origin='staff')=(actor_user_id is not null))
);
create index annual_penalty_assessments_property_idx on public.annual_penalty_assessments(property_id);
create index annual_penalty_assessments_actor_idx on public.annual_penalty_assessments(actor_user_id);

alter table public.annual_penalty_policy enable row level security;
revoke all on public.annual_penalty_policy from public, anon, authenticated;
grant select on public.annual_penalty_policy to authenticated;
create policy "Active staff read annual_penalty_policy" on public.annual_penalty_policy
  for select to authenticated using ((select public.current_user_role()) in ('admin','secretary','treasurer'));

alter table public.annual_penalty_schedules enable row level security;
revoke all on public.annual_penalty_schedules from public, anon, authenticated;
grant select on public.annual_penalty_schedules to authenticated;
create policy "Active staff read annual_penalty_schedules" on public.annual_penalty_schedules
  for select to authenticated using ((select public.current_user_role()) in ('admin','secretary','treasurer'));

alter table public.annual_penalty_assessments enable row level security;
revoke all on public.annual_penalty_assessments from public, anon, authenticated;
grant select on public.annual_penalty_assessments to authenticated;
create policy "Active staff read annual_penalty_assessments" on public.annual_penalty_assessments
  for select to authenticated using ((select public.current_user_role()) in ('admin','secretary','treasurer'));

create or replace view public.property_balance_items
with (security_invoker = true) as
with entry_totals as (
  select property_id, sum(amount) as amount
  from public.balance_entries where voided_at is null group by property_id
), raw_items as (
  select e.property_id, 'entry'::text as kind, e.id as ref_id, e.category,
    e.as_of_date as item_date, coalesce(e.description, e.category || ' balance') as label,
    e.amount as original, null::integer as penalty_no, null::numeric as rate,
    null::numeric as base_amount, e.created_at as ordered_at,
    case when e.category = 'Association Dues' then 'dues' else e.category end as pool_type,
    0 as priority
  from public.balance_entries e where e.voided_at is null
  union all
  -- Legacy opening balances without balance-entry rows must not disappear.
  select p.id, 'opening', md5('opening:' || p.id::text)::uuid, 'Opening balance',
    p.opening_balance_as_of, coalesce(p.opening_balance_note, 'Recorded opening balance'),
    (coalesce(p.opening_balance, 0) - coalesce(e.amount, 0))::numeric(12,2),
    null::integer, null::numeric, null::numeric, p.created_at, 'dues', 0
  from public.properties p left join entry_totals e on e.property_id = p.id
  where coalesce(p.opening_balance, 0) <> coalesce(e.amount, 0)
  union all
  select c.property_id,
    case c.charge_type when 'Association Dues' then 'dues'
      when 'Penalty / Late Fee' then 'penalty' else 'charge' end,
    c.id, c.charge_type,
    coalesce(c.billing_month, lp.anniversary_date, (c.created_at at time zone 'Asia/Manila')::date),
    coalesce(c.description, c.charge_type), c.amount,
    lp.anniversary_no, lp.rate, lp.base_amount, c.created_at,
    case when c.charge_type in ('Association Dues', 'Penalty / Late Fee')
      then 'dues' else c.charge_type end,
    case c.charge_type when 'Penalty / Late Fee' then 1 when 'Association Dues' then 2 else 0 end
  from public.property_charges c
  left join lateral (
    select z.anniversary_no, z.anniversary_date, z.rate, z.base_amount from (
      select x.anniversary_no, x.anniversary_date, x.rate, x.base_amount
      from public.late_payment_penalties x where x.charge_id = c.id
      union all
      select x.anniversary_no, x.anniversary_date, x.rate, x.base_amount
      from public.annual_penalty_assessments x where x.charge_id = c.id
    ) z order by z.anniversary_no, z.anniversary_date limit 1
  ) lp on true
  where c.voided_at is null
  union all
  select a.property_id, 'adjustment', a.id, 'Account adjustment',
    (a.created_at at time zone 'Asia/Manila')::date, a.reason, a.balance_effect,
    null::integer, null::numeric, null::numeric, a.created_at, null::text, 0
  from public.account_adjustments a where a.reversed_at is null
  union all
  select a.property_id, 'adjustment', a.id, 'Moved-account reconciliation',
    (a.recorded_at at time zone 'Asia/Manila')::date, a.reason, a.adjustment_amount,
    null::integer, null::numeric, null::numeric, a.recorded_at, null::text, 0
  from public.moved_account_reconciliations a
), payment_pools as (
  select property_id,
    case when coalesce(charge_type, 'Association Dues') in ('Association Dues', 'Penalty / Late Fee')
      then 'dues' else charge_type end as pool_type,
    sum(greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0)) as effect
  from public.payments where status is distinct from 'Voided'
  group by property_id, 2
), ranked_typed as (
  select i.*, coalesce(p.effect, 0) as typed_effect,
    sum(greatest(i.original, 0)) over (partition by i.property_id, i.pool_type
      order by i.priority, i.item_date nulls first, i.ordered_at, i.ref_id
      rows between unbounded preceding and current row) as cumulative
  from raw_items i left join payment_pools p
    on p.property_id = i.property_id and p.pool_type = i.pool_type
), typed_items as (
  select r.*, greatest(0, least(greatest(original, 0), cumulative - typed_effect)) as typed_unpaid
  from ranked_typed r
), property_pools as (
  select p.id as property_id,
    -- Typed effects already used above are subtracted, so no payment is counted twice.
    greatest(coalesce(pay.effect, 0) - coalesce(i.consumed, 0), 0)
      + coalesce(i.credit, 0) as general_credit
  from public.properties p
  left join (select property_id, sum(effect) as effect from payment_pools group by property_id) pay
    on pay.property_id = p.id
  left join (
    select property_id, sum(greatest(original, 0) - typed_unpaid) as consumed,
      sum(greatest(-original, 0)) as credit
    from typed_items group by property_id
  ) i on i.property_id = p.id
), ranked_general as (
  select i.*, p.general_credit,
    sum(i.typed_unpaid) over (partition by i.property_id
      order by i.item_date nulls first, i.kind, i.ref_id
      rows between unbounded preceding and current row) as cumulative_unpaid
  from typed_items i join property_pools p using (property_id)
)
select property_id, kind, ref_id, category, item_date, label,
  original::numeric(12,2) as original,
  greatest(0, least(typed_unpaid, cumulative_unpaid - general_credit))::numeric(12,2) as unpaid,
  penalty_no, rate, base_amount
from ranked_general;


create or replace function public.post_due_penalties(p_property_id bigint default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := public.hoa_manila_today();
  effective date;
  configured_rate numeric;
  configured_months integer;
  actor uuid := auth.uid();
  actor_role text;
  p record;
  root record;
  sched public.annual_penalty_schedules%rowtype;
  first_date date;
  due_date date;
  cycle integer;
  base numeric(12,2);
  cash numeric(12,2);
  cid uuid;
  count_posted integer := 0;
  audit_flag text;
  audit_rows integer;
begin
  if actor is not null then
    actor_role := public.current_user_role();
    if coalesce(actor_role,'') not in ('admin','secretary','treasurer') then
      raise exception using errcode='42501', message='An active staff account is required.';
    end if;
    if p_property_id is null and actor_role <> 'admin' then
      raise exception using errcode='42501', message='Only Admin can request all-account penalty posting.';
    end if;
  elsif session_user not in ('postgres','supabase_admin')
     or current_setting('role',true) in ('anon','authenticated') then
    raise exception using errcode='42501', message='Scheduled posting requires the trusted database scheduler.';
  end if;
  select effective_date into strict effective from public.annual_penalty_policy where id=1;
  if today < effective then return 0; end if;
  select late_penalty_rate,late_penalty_first_after_months into strict configured_rate,configured_months
    from public.system_settings where id=1;
  if configured_rate is null or configured_rate not between 0 and 1
     or configured_months is null or configured_months not between 1 and 600 then
    raise exception 'Invalid annual penalty settings; no charges were posted.';
  end if;

  -- All posting paths lock the account BEFORE reading allocation balances.
  -- Payments and entered-balance writes use the same property lock.
  for p in select id,current_balance from public.properties
    where homeowner_status='active' and (p_property_id is null or id=p_property_id)
    order by id for update
  loop
    if exists(select 1 from public.financial_invariant_report f
      where f.property_id=p.id and abs(f.reconciliation_difference)>0.005)
      or abs(coalesce((select sum(i.unpaid) from public.property_balance_items i where i.property_id=p.id),0)
        - greatest(p.current_balance,0))>0.005 then
      raise exception 'Account % does not reconcile; no annual penalties were committed.',p.id;
    end if;
    for root in
      select i.*, i.unpaid + coalesce((
        select sum(pi.unpaid) from public.annual_penalty_schedules ps
        join public.annual_penalty_assessments pa on pa.schedule_id=ps.id
        join public.property_balance_items pi on pi.kind='penalty' and pi.ref_id=pa.charge_id
        where ps.property_id=i.property_id and ps.source_kind=i.kind and ps.source_ref=i.ref_id
      ),0) as compound_base
      from public.property_balance_items i
      where i.property_id=p.id and i.original>0 and i.item_date is not null
        and ((i.kind='entry' and i.category='Association Dues')
          or i.kind in ('dues','opening','adjustment')
          or (i.kind='penalty' and not exists (
            select 1 from public.annual_penalty_assessments a where a.charge_id=i.ref_id)))
        -- Generated penalties belong to their original source, never a second root.
      order by i.item_date,i.kind,i.ref_id
    loop
      insert into public.annual_penalty_schedules(property_id,source_kind,source_ref,as_of_date,first_after_months)
        values(p.id,root.kind,root.ref_id,root.item_date,configured_months)
        on conflict(property_id,source_kind,source_ref) do nothing;
      select * into strict sched from public.annual_penalty_schedules
        where property_id=p.id and source_kind=root.kind and source_ref=root.ref_id for update;
      first_date := (sched.as_of_date + make_interval(months=>sched.first_after_months))::date;
      if first_date>today then continue; end if;
      cycle := ((extract(year from today)::integer-extract(year from first_date)::integer)*12
        + extract(month from today)::integer-extract(month from first_date)::integer)/12+1;
      due_date := (sched.as_of_date+make_interval(months=>sched.first_after_months+12*(cycle-1)))::date;
      if due_date>today then
        cycle:=cycle-1;
        due_date:=(sched.as_of_date+make_interval(months=>sched.first_after_months+12*(cycle-1)))::date;
      end if;
      if cycle<sched.next_anniversary_no then continue; end if;
      -- Dates before activation are skipped, never backfilled. A missed multi-year
      -- job run assesses only the latest anniversary at today's unpaid balance.
      if due_date<effective then
        update public.annual_penalty_schedules set next_anniversary_no=cycle+1 where id=sched.id;
        continue;
      end if;
      -- The FOR query snapshots ALL root bases before any new charges are
      -- inserted, so shared payment allocation cannot inflate a later root.
      base:=round(greatest(0,least(root.compound_base,greatest(p.current_balance,0))),2);
      cash:=round(base*configured_rate,2);
      cid:=null;
      if cash>0 then
        insert into public.property_charges(property_id,charge_type,description,amount,billing_month,created_by,created_by_name)
          values(p.id,'Penalty / Late Fee',
            left(format('Annual compound penalty %s: %s%% of PHP %s unpaid; anniversary %s; source %s %s',
              cycle,configured_rate*100,base,due_date,root.kind,root.ref_id),250),
            cash,null,actor,case when actor is null then 'System (automatic)' else 'System (staff-triggered)' end)
          returning id into cid;
      end if;
      -- This immutable journal is the mandatory audit for unattended jobs, which
      -- must not impersonate an Admin (activity_log.user_id is NOT NULL).
      insert into public.annual_penalty_assessments(schedule_id,property_id,anniversary_no,
        anniversary_date,assessed_on,base_amount,rate,penalty_amount,charge_id,actor_user_id,origin)
        values(sched.id,p.id,cycle,due_date,today,base,configured_rate,cash,cid,actor,
          case when actor is null then 'scheduled_system' else 'staff' end);
      if cash>0 and actor is not null then
        audit_flag:=current_setting('app.audit_trigger',true);
        perform set_config('app.audit_trigger','on',true);
        insert into public.activity_log(user_id,action,target)
          values(actor,'Annual Penalty Posted',format('Property %s — PHP %s at %s%% on PHP %s; anniversary %s; charge %s',p.id,cash,configured_rate*100,base,due_date,cid));
        get diagnostics audit_rows = row_count;
        perform set_config('app.audit_trigger',coalesce(audit_flag,'off'),true);
        if audit_rows<>1 then raise exception 'Annual penalty audit was not recorded.'; end if;
      end if;
      update public.annual_penalty_schedules set next_anniversary_no=cycle+1 where id=sched.id;
      if cash>0 then count_posted:=count_posted+1; end if;
    end loop;
  end loop;
  return count_posted;
end;
$$;
revoke all on function public.post_due_penalties(bigint) from public,anon;
grant execute on function public.post_due_penalties(bigint) to authenticated;

-- Voiding the source must also void its future-generated penalty charges.
create function public.void_annual_source_penalties()
returns trigger language plpgsql security definer set search_path='' as $$
declare source_voided boolean;
begin
  if tg_table_name='account_adjustments' then
    source_voided:=old.reversed_at is null and new.reversed_at is not null;
  else
    source_voided:=old.voided_at is null and new.voided_at is not null;
  end if;
  if source_voided then
    update public.property_charges c set voided_at=now(),voided_by=auth.uid(),
      void_reason=left('Source voided: '||coalesce(to_jsonb(new)->>'void_reason',to_jsonb(new)->>'reason','Annual penalty source'),250)
      where c.voided_at is null and c.id in (
        select a.charge_id from public.annual_penalty_assessments a
        join public.annual_penalty_schedules s on s.id=a.schedule_id
        where s.source_ref=new.id and s.property_id=new.property_id
          and ((tg_table_name='balance_entries' and s.source_kind='entry')
            or (tg_table_name='property_charges' and s.source_kind in ('dues','penalty'))
            or (tg_table_name='account_adjustments' and s.source_kind='adjustment'))
      );
  end if;
  return new;
end;
$$;
revoke all on function public.void_annual_source_penalties() from public,anon,authenticated;
create trigger void_annual_entry_penalties after update of voided_at on public.balance_entries
  for each row execute function public.void_annual_source_penalties();
create trigger void_annual_charge_penalties after update of voided_at on public.property_charges
  for each row execute function public.void_annual_source_penalties();

create trigger void_annual_adjustment_penalties after update of reversed_at on public.account_adjustments
  for each row execute function public.void_annual_source_penalties();

-- Keep the existing scheduler; no posting is executed by this migration.
do $$ begin
  if not exists(select 1 from cron.job where jobname='post-late-penalties'
    and active and command='select public.post_due_penalties()'
    and schedule='10 16 * * *') then
    raise exception 'The expected active daily penalty job is missing; no change was installed.';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
