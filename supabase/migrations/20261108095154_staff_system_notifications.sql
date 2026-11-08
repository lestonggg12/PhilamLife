-- Additive only. Review and run isolated tests before deployment. Never posts money.
begin;
create schema system_notification_private;
revoke all on schema system_notification_private from public, anon, authenticated;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('collection_reminder','collection_run','penalty_anniversary')),
  dedupe_key text not null unique,
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info','warning')),
  payload jsonb not null default '{}'::jsonb,
  link text not null default '/overdue-accounts' check (link = '/overdue-accounts'),
  created_at timestamptz not null default now()
);
create index notifications_newest_idx on public.notifications(created_at desc, id desc);
create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(notification_id,user_id)
);
create index notification_reads_user_idx on public.notification_reads(user_id,notification_id);
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
revoke all on public.notifications, public.notification_reads from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, delete on public.notification_reads to authenticated;
create policy notifications_staff_read on public.notifications for select to authenticated
  using ((select public.current_user_role()) in ('admin','secretary','treasurer'));
create policy notification_reads_own_select on public.notification_reads for select to authenticated
  using (user_id=(select auth.uid()) and (select public.current_user_role()) in ('admin','secretary','treasurer'));
create policy notification_reads_own_insert on public.notification_reads for insert to authenticated
  with check (user_id=(select auth.uid()) and (select public.current_user_role()) in ('admin','secretary','treasurer'));
create policy notification_reads_own_delete on public.notification_reads for delete to authenticated
  using (user_id=(select auth.uid()) and (select public.current_user_role()) in ('admin','secretary','treasurer'));

-- Installation boundary prevents misleading historical notices on first deployment.
create table system_notification_private.state (
  id boolean primary key default true check(id), started_on date not null, last_reminder_day date not null
);
insert into system_notification_private.state values(true,(now() at time zone 'Asia/Manila')::date,
  (now() at time zone 'Asia/Manila')::date-1);
create table system_notification_private.collection_snapshots (
  collection_date date primary key, captured_at timestamptz not null, accounts jsonb not null
);
alter table system_notification_private.state enable row level security;
alter table system_notification_private.collection_snapshots enable row level security;
revoke all on all tables in schema system_notification_private from public, anon, authenticated;

create function system_notification_private.collection_date(p_month date, p_billing_day integer)
returns date language sql immutable set search_path='' as $$
  select date_trunc('month',p_month)::date + least(coalesce(p_billing_day,1),
    extract(day from (date_trunc('month',p_month)+interval '1 month - 1 day'))::integer)-1
$$;
create function system_notification_private.peso(p_amount numeric)
returns text language sql immutable set search_path='' as $$
  select '₱'||to_char(coalesce(p_amount,0),'FM999,999,999,999,999,990.00')
$$;

-- Explicit clock is private and only used by the isolated SQL tests.
-- Refuse late snapshots: a balance observed AFTER billing is not a pre-billing balance.
create function system_notification_private.capture(p_clock timestamptz)
returns void language plpgsql set search_path='' as $$
declare d date := (p_clock at time zone 'Asia/Manila')::date; s public.system_settings%rowtype;
begin
  select * into strict s from public.system_settings where id=1;
  if d<>system_notification_private.collection_date(d,s.billing_day)
    or (p_clock at time zone 'Asia/Manila')::time >= time '00:05' then return; end if;
  insert into system_notification_private.collection_snapshots(collection_date,captured_at,accounts)
  select d,p_clock,coalesce(jsonb_agg(jsonb_build_object(
    'property_id',p.id,'balance',p.current_balance,'name',p.homeowner_name,
    'block',p.block,'lot_number',p.lot_number,'classification',p.property_classification,
    'expected_dues',public.compute_monthly_dues(p.lot_size_sqm,s.price_per_sqm),
    'already_billed',exists(select 1 from public.property_charges c where c.property_id=p.id
      and c.billing_month=date_trunc('month',d)::date and c.charge_type='Association Dues')
  ) order by p.id),'[]'::jsonb)
  from public.properties p where p.homeowner_status='active'
  on conflict(collection_date) do nothing;
end $$;

create function system_notification_private.generate(p_today date)
returns void language plpgsql set search_path='' as $$
declare
  state_row system_notification_private.state%rowtype;
  bday integer; d date; collection date; snap system_notification_private.collection_snapshots%rowtype;
  r record; top_accounts jsonb; data jsonb; report_body text; delayed text;
begin
  -- Serializes concurrent/retried generators, independent of financial locks.
  select * into strict state_row from system_notification_private.state where id for update;
  select billing_day into strict bday from public.system_settings where id=1;
  if p_today<state_row.started_on then return; end if;

  for d in select x::date from generate_series(greatest(state_row.started_on,state_row.last_reminder_day+1)::timestamp,
    p_today::timestamp,interval '1 day') x
  loop
    -- Looking seven days forward handles both cross-month and capped month-end dates.
    collection:=system_notification_private.collection_date(d+7,bday);
    if collection<>d+7 then continue; end if;
    select count(*) filter(where property_classification='homeowner') as homeowners,
      count(*) filter(where property_classification='lot_owner') as lot_owners,
      count(*) filter(where property_classification='unclassified') as unclassified,
      coalesce(sum(current_balance),0) as total,
      coalesce(sum(current_balance) filter(where property_classification='homeowner'),0) as homeowner_total,
      coalesce(sum(current_balance) filter(where property_classification='lot_owner'),0) as lot_owner_total,
      coalesce(sum(current_balance) filter(where property_classification='unclassified'),0) as unclassified_total
      into r from public.properties where homeowner_status='active' and current_balance>0;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.amount desc,a.property_id),'[]'::jsonb) into top_accounts from (
      select id as property_id,homeowner_name as name,block,lot_number,current_balance as amount,
        system_notification_private.peso(current_balance) as amount_formatted
      from public.properties where homeowner_status='active' and current_balance>0
      order by current_balance desc,id limit 5
    ) a;
    delayed:=case when d<p_today then format('Delayed reminder for %s. Figures observed on %s. ',d,p_today) else '' end;
    insert into public.notifications(kind,dedupe_key,title,body,payload)
    values('collection_reminder','collection_reminder:'||collection,
      case when d=p_today then 'Dues collection in 7 days' else 'Dues collection reminder — delayed' end,
      delayed||format(case when d=p_today then
        'Monthly dues will be collected on %s. %s homeowners, %s lot owners and %s unclassified lots have unpaid balances totaling %s. Contact them to settle before the collection date.'
        else 'Monthly dues collection date: %s. %s homeowners, %s lot owners and %s unclassified lots have unpaid balances totaling %s. Contact them to settle their balances.' end,
        to_char(collection,'FMMonth DD, YYYY'),r.homeowners,r.lot_owners,r.unclassified,system_notification_private.peso(r.total)),
      to_jsonb(r)||jsonb_build_object('collection_date',collection,'scheduled_for',d,'observed_on',p_today,
        'top_accounts',top_accounts,'total_formatted',system_notification_private.peso(r.total)))
    on conflict(dedupe_key) do nothing;
  end loop;

  for collection in select system_notification_private.collection_date(x::date,bday)
    from generate_series(date_trunc('month',state_row.started_on)::timestamp,
      date_trunc('month',p_today)::timestamp,interval '1 month') x
  loop
    if collection<state_row.started_on or collection>p_today
      or exists(select 1 from public.notifications where dedupe_key='collection_run:'||collection) then continue; end if;
    select * into snap from system_notification_private.collection_snapshots where collection_date=collection;
    if not found then
      insert into public.notifications(kind,dedupe_key,title,body,severity,payload)
      values('collection_run','collection_run:'||collection,'Monthly dues report unavailable — '||collection,
        'The pre-billing snapshot was missed. Advance-credit deductions and collection-day unpaid totals cannot be verified. Open Overdue Accounts for current balances.',
        'warning',jsonb_build_object('collection_date',collection,'snapshot_missing',true,'top_accounts','[]'::jsonb))
      on conflict(dedupe_key) do nothing;
      continue;
    end if;
    -- A failed/late billing job is retried on subsequent generator runs; never report zero deductions as success.
    if exists(select 1 from jsonb_to_recordset(snap.accounts) as a(property_id bigint,expected_dues numeric,already_billed boolean)
      where a.expected_dues>0 and not a.already_billed and not exists(
        select 1 from public.property_charges c where c.property_id=a.property_id
          and c.billing_month=date_trunc('month',collection)::date and c.charge_type='Association Dues'
          and c.created_at>=snap.captured_at and c.created_by_name='System (automatic)' and c.voided_at is null
      )) then continue; end if;
    with accounts as (
      select a.*,c.amount as dues,p.current_balance,
        least(greatest(-a.balance,0),c.amount) as deducted,
        coalesce(o.aging_complete,false) and o.balance>0.005 and o.overdue_amount>0.005 as overdue
      from jsonb_to_recordset(snap.accounts) as a(property_id bigint,balance numeric,already_billed boolean)
      join public.properties p on p.id=a.property_id
      join public.property_charges c on c.property_id=a.property_id
        and c.billing_month=date_trunc('month',collection)::date and c.charge_type='Association Dues'
        and c.voided_at is null and c.created_at>=snap.captured_at and c.created_by_name='System (automatic)'
      left join public.property_overdue_summary o on o.property_id=p.id
      where not a.already_billed
    ) select count(*) filter(where deducted>0) as credit_accounts,
      coalesce(sum(deducted),0) as credit_deducted,
      count(*) filter(where deducted>0 and deducted>=dues) as fully_covered,
      count(*) filter(where deducted>0 and deducted<dues) as partly_covered,
      count(*) filter(where balance>=0 and current_balance>0) as unpaid_accounts,
      coalesce(sum(current_balance) filter(where balance>=0 and current_balance>0),0) as unpaid_total,
      count(*) filter(where balance>=0 and current_balance>0 and overdue) as overdue_accounts
      into r from accounts;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.amount desc,a.property_id),'[]'::jsonb) into top_accounts from (
      select p.id as property_id,p.homeowner_name as name,p.block,p.lot_number,p.current_balance as amount,
        system_notification_private.peso(p.current_balance) as amount_formatted
      from public.properties p join jsonb_to_recordset(snap.accounts) as s(property_id bigint) on s.property_id=p.id
      where p.current_balance>0 order by p.current_balance desc,p.id limit 5
    ) a;
    report_body:=format('Advance credits were deducted for %s accounts (%s in total; %s fully covered, %s partly covered). %s accounts had no advance credit before billing and have an unpaid balance of %s; %s of them appear in Overdue Accounts at reporting time.',
      r.credit_accounts,system_notification_private.peso(r.credit_deducted),r.fully_covered,r.partly_covered,
      r.unpaid_accounts,system_notification_private.peso(r.unpaid_total),r.overdue_accounts);
    if collection<p_today then report_body:=report_body||format(' Delayed report: unpaid balances and overdue status observed on %s, not on the collection date.',p_today); end if;
    if exists(select 1 from jsonb_to_recordset(snap.accounts) as s(already_billed boolean) where already_billed)
      then report_body:=report_body||' Accounts billed before the snapshot are excluded from deduction totals.'; end if;
    insert into public.notifications(kind,dedupe_key,title,body,payload)
    values('collection_run','collection_run:'||collection,'Monthly dues collected — '||to_char(collection,'FMMonth DD, YYYY'),
      report_body,to_jsonb(r)||jsonb_build_object('collection_date',collection,'observed_on',p_today,'top_accounts',top_accounts,
        'credit_deducted_formatted',system_notification_private.peso(r.credit_deducted),
        'unpaid_total_formatted',system_notification_private.peso(r.unpaid_total)))
    on conflict(dedupe_key) do nothing;
  end loop;

  -- The CURRENT live posting function uses this immutable journal, not the legacy late_payment_penalties table.
  -- A scheduled catch-up keeps its actual assessed_on date and original anniversary_date.
  for d in select distinct assessed_on from public.annual_penalty_assessments
    where origin='scheduled_system' and actor_user_id is null and penalty_amount>0 and charge_id is not null
      and assessed_on between state_row.started_on and p_today
  loop
    if exists(select 1 from public.notifications where dedupe_key='penalty_anniversary:'||d) then continue; end if;
    select count(*) as balances,coalesce(sum(a.penalty_amount),0) as total,
      count(*) filter(where p.property_classification='homeowner') as homeowners,
      count(*) filter(where p.property_classification='lot_owner') as lot_owners,
      count(*) filter(where p.property_classification='unclassified') as unclassified,
      coalesce(sum(a.penalty_amount) filter(where p.property_classification='homeowner'),0) as homeowner_total,
      coalesce(sum(a.penalty_amount) filter(where p.property_classification='lot_owner'),0) as lot_owner_total,
      coalesce(sum(a.penalty_amount) filter(where p.property_classification='unclassified'),0) as unclassified_total,
      count(*) filter(where a.anniversary_date<d) as caught_up_balances
      into r from public.annual_penalty_assessments a join public.properties p on p.id=a.property_id
      where a.assessed_on=d and a.origin='scheduled_system' and a.actor_user_id is null and a.penalty_amount>0 and a.charge_id is not null;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.amount desc,a.property_id),'[]'::jsonb) into top_accounts from (
      select p.id as property_id,p.homeowner_name as name,p.block,p.lot_number,sum(a.penalty_amount) as amount,
        system_notification_private.peso(sum(a.penalty_amount)) as amount_formatted
      from public.annual_penalty_assessments a join public.properties p on p.id=a.property_id
      where a.assessed_on=d and a.origin='scheduled_system' and a.actor_user_id is null and a.penalty_amount>0 and a.charge_id is not null
      group by p.id,p.homeowner_name,p.block,p.lot_number order by amount desc,p.id limit 5
    ) a;
    insert into public.notifications(kind,dedupe_key,title,body,payload)
    values('penalty_anniversary','penalty_anniversary:'||d,'Yearly penalties applied',
      format('%s balances were charged yearly anniversary late penalties totaling %s (%s homeowners, %s lot owners, %s unclassified). %s were catch-up assessments for earlier anniversaries. Posted on %s.',
        r.balances,system_notification_private.peso(r.total),r.homeowners,r.lot_owners,r.unclassified,r.caught_up_balances,d),
      to_jsonb(r)||jsonb_build_object('assessed_on',d,'top_accounts',top_accounts,'total_formatted',system_notification_private.peso(r.total)))
    on conflict(dedupe_key) do nothing;
  end loop;
  update system_notification_private.state set last_reminder_day=greatest(last_reminder_day,p_today) where id;
end $$;

create function public.snapshot_collection_balances()
returns void language sql security definer set search_path='' as $$
  select system_notification_private.capture(now())
$$;
create function public.generate_system_notifications()
returns void language plpgsql security definer set search_path='' as $$
begin
  -- An early manual retry must not finalize a missing-snapshot report before the jobs run.
  if (now() at time zone 'Asia/Manila')::time < time '00:20' then return; end if;
  perform system_notification_private.generate((now() at time zone 'Asia/Manila')::date);
end $$;
revoke all on all functions in schema system_notification_private from public, anon, authenticated;
revoke all on function public.snapshot_collection_balances(), public.generate_system_notifications() from public, anon, authenticated;
-- pg_cron executes as migration owner. No browser EXECUTE grants.
select cron.schedule('snapshot-collection-notifications','0 16 * * *','select public.snapshot_collection_balances()');
select cron.schedule('generate-system-notifications','20 16 * * *','select public.generate_system_notifications()');
commit;
