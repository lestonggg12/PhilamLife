-- PhilamLife HOA ledger foundation
-- Critical accounting controls for RA 9904-compliant record keeping.
-- This migration is intentionally non-destructive: legacy payments remain intact,
-- no historical debt is invented, and approved schedules must be activated before
-- recurring assessments or penalties can be posted.

create extension if not exists pgcrypto;

create or replace function public.hoa_manila_today()
returns date
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select timezone('Asia/Manila', now())::date;
$$;

alter table public.service_transactions
  add column if not exists property_id bigint references public.properties(id) on delete restrict;

create index if not exists service_transactions_property_id_idx
  on public.service_transactions (property_id);

update public.service_transactions transaction
set property_id = property.id
from public.properties property
where transaction.property_id is null
  and lower(trim(transaction.block_name)) = lower(trim(property.block))
  and regexp_replace(lower(trim(transaction.lot_number)), '^lot\s*', '') =
      regexp_replace(lower(trim(property.lot_number::text)), '^lot\s*', '');

create table if not exists public.property_ownerships (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  homeowner_name text not null check (length(trim(homeowner_name)) > 0),
  starts_on date not null,
  ends_on date,
  source text not null default 'system',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);

create unique index if not exists property_ownerships_one_current_idx
  on public.property_ownerships (property_id)
  where ends_on is null;

create index if not exists property_ownerships_property_dates_idx
  on public.property_ownerships (property_id, starts_on, ends_on);

insert into public.property_ownerships (
  property_id,
  homeowner_name,
  starts_on,
  source
)
select
  property.id,
  property.homeowner_name,
  coalesce((property.created_at at time zone 'Asia/Manila')::date, public.hoa_manila_today()),
  'legacy-backfill'
from public.properties property
where not exists (
  select 1
  from public.property_ownerships ownership
  where ownership.property_id = property.id
    and ownership.ends_on is null
);

create or replace function public.sync_property_ownership_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.property_ownerships (
      property_id, homeowner_name, starts_on, source, created_by
    )
    values (
      new.id,
      new.homeowner_name,
      coalesce((new.created_at at time zone 'Asia/Manila')::date, public.hoa_manila_today()),
      'property-created',
      auth.uid()
    )
    on conflict do nothing;
  elsif new.homeowner_name is distinct from old.homeowner_name then
    update public.property_ownerships
    set ends_on = public.hoa_manila_today() - 1
    where property_id = old.id
      and ends_on is null;

    insert into public.property_ownerships (
      property_id, homeowner_name, starts_on, source, created_by
    )
    values (
      new.id, new.homeowner_name, public.hoa_manila_today(), 'homeowner-change', auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists sync_property_ownership_history_trigger on public.properties;
create trigger sync_property_ownership_history_trigger
after insert or update of homeowner_name on public.properties
for each row execute function public.sync_property_ownership_history();

create table if not exists public.assessment_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  charge_type text not null check (
    charge_type in (
      'regular_dues', 'special_assessment', 'late_penalty',
      'amenity', 'sticker_id', 'document_fee', 'other'
    )
  ),
  amount numeric(12, 2) not null check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'annual', 'one_time')),
  effective_from date not null,
  effective_to date,
  due_day smallint not null default 5 check (due_day between 1 and 28),
  grace_period_days smallint not null default 0 check (grace_period_days between 0 and 90),
  late_penalty numeric(12, 2) not null default 0 check (late_penalty >= 0),
  board_resolution_reference text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  is_approved boolean not null default false,
  is_active boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (
    not is_approved
    or (
      board_resolution_reference is not null
      and length(trim(board_resolution_reference)) > 0
      and approved_at is not null
      and approved_by is not null
    )
  )
);

insert into public.assessment_schedules (
  name,
  charge_type,
  amount,
  frequency,
  effective_from,
  due_day,
  grace_period_days,
  late_penalty,
  is_approved,
  is_active
)
select
  'Legacy Association Dues',
  'regular_dues',
  coalesce(settings.dues_amount, 0),
  'monthly',
  date_trunc('month', timezone('Asia/Manila', now()))::date,
  greatest(1, least(28, coalesce(settings.due_day, 5))),
  greatest(0, least(90, coalesce(settings.grace_period_days, 0))),
  greatest(0, coalesce(settings.late_penalty, 0)),
  false,
  false
from public.system_settings settings
where settings.id = 1
  and not exists (
    select 1
    from public.assessment_schedules schedule
    where schedule.charge_type = 'regular_dues'
  );

create table if not exists public.homeowner_charges (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  ownership_id uuid references public.property_ownerships(id) on delete restrict,
  schedule_id uuid references public.assessment_schedules(id) on delete restrict,
  charge_type text not null check (
    charge_type in (
      'regular_dues', 'special_assessment', 'late_penalty',
      'amenity', 'sticker_id', 'document_fee', 'opening_balance', 'other'
    )
  ),
  description text not null check (length(trim(description)) > 0),
  period_start date,
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'open'
    check (status in ('open', 'partial', 'paid', 'voided')),
  parent_charge_id uuid references public.homeowner_charges(id) on delete restrict,
  approval_reference text,
  posted_by uuid references auth.users(id),
  posted_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists homeowner_charges_schedule_period_idx
  on public.homeowner_charges (property_id, schedule_id, period_start)
  where schedule_id is not null and status <> 'voided';

create unique index if not exists homeowner_charges_one_penalty_idx
  on public.homeowner_charges (parent_charge_id, charge_type)
  where parent_charge_id is not null and charge_type = 'late_penalty'
    and status <> 'voided';

create index if not exists homeowner_charges_property_due_idx
  on public.homeowner_charges (property_id, due_date);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id bigint not null references public.payments(id) on delete restrict,
  charge_id uuid not null references public.homeowner_charges(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  allocated_by uuid not null references auth.users(id),
  allocated_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text,
  unique (payment_id, charge_id),
  check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or
    (reversed_at is not null and reversed_by is not null
      and length(trim(reversal_reason)) > 0)
  )
);

create index if not exists payment_allocations_charge_idx
  on public.payment_allocations (charge_id)
  where reversed_at is null;

create table if not exists public.account_adjustments (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  charge_id uuid references public.homeowner_charges(id) on delete restrict,
  adjustment_type text not null check (
    adjustment_type in (
      'credit', 'waiver', 'write_off', 'refund',
      'debit_correction', 'credit_correction', 'reversal'
    )
  ),
  balance_effect numeric(12, 2) not null check (balance_effect <> 0),
  reason text not null check (length(trim(reason)) >= 5),
  approval_reference text not null check (length(trim(approval_reference)) > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references auth.users(id),
  reversal_reason text
);

create index if not exists account_adjustments_property_idx
  on public.account_adjustments (property_id, created_at desc);

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  close_note text,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id),
  reopen_reason text,
  created_at timestamptz not null default now(),
  unique (starts_on, ends_on),
  check (ends_on >= starts_on)
);

create table if not exists public.funds (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  fund_type text not null check (
    fund_type in ('operating', 'reserve', 'special_assessment', 'amenity')
  ),
  is_restricted boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.funds (code, name, fund_type, is_restricted)
values
  ('OPERATING', 'Operating Fund', 'operating', false),
  ('RESERVE', 'Reserve Fund', 'reserve', true),
  ('SPECIAL', 'Special Assessment Fund', 'special_assessment', true),
  ('AMENITY', 'Amenity and Service Fund', 'amenity', false)
on conflict (code) do nothing;

alter table public.homeowner_charges
  add column if not exists fund_id uuid references public.funds(id) on delete restrict;

create table if not exists public.bank_deposits (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete restrict,
  deposit_date date not null,
  bank_reference text not null,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending', 'cleared', 'reconciled', 'voided')),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now(),
  cleared_at timestamptz,
  unique (fund_id, bank_reference)
);

create table if not exists public.bank_deposit_receipts (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.bank_deposits(id) on delete restrict,
  payment_id bigint references public.payments(id) on delete restrict,
  service_transaction_id uuid references public.service_transactions(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  check (
    (payment_id is not null and service_transaction_id is null)
    or
    (payment_id is null and service_transaction_id is not null)
  )
);

create unique index if not exists bank_deposit_receipts_payment_idx
  on public.bank_deposit_receipts (deposit_id, payment_id)
  where payment_id is not null;

create unique index if not exists bank_deposit_receipts_service_idx
  on public.bank_deposit_receipts (deposit_id, service_transaction_id)
  where service_transaction_id is not null;

create table if not exists public.collection_actions (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  action_type text not null check (
    action_type in (
      'statement_sent', 'reminder_sent', 'delinquency_notice',
      'dispute_opened', 'hearing_scheduled', 'resolved'
    )
  ),
  action_date timestamptz not null default now(),
  details text not null,
  document_reference text,
  created_by uuid not null references auth.users(id)
);

create or replace view public.homeowner_ledger_summary
with (security_invoker = true)
as
with active_allocations as (
  select charge_id, sum(amount) as allocated
  from public.payment_allocations
  where reversed_at is null
  group by charge_id
),
charge_totals as (
  select
    charge.property_id,
    sum(charge.amount) filter (where charge.status <> 'voided') as assessed,
    sum(least(charge.amount, coalesce(allocation.allocated, 0)))
      filter (where charge.status <> 'voided') as allocated,
    sum(greatest(charge.amount - coalesce(allocation.allocated, 0), 0))
      filter (
        where charge.status <> 'voided'
          and charge.due_date >= public.hoa_manila_today()
      ) as current_bucket,
    sum(greatest(charge.amount - coalesce(allocation.allocated, 0), 0))
      filter (
        where charge.status <> 'voided'
          and public.hoa_manila_today() - charge.due_date between 1 and 30
      ) as aging_1_30,
    sum(greatest(charge.amount - coalesce(allocation.allocated, 0), 0))
      filter (
        where charge.status <> 'voided'
          and public.hoa_manila_today() - charge.due_date between 31 and 60
      ) as aging_31_60,
    sum(greatest(charge.amount - coalesce(allocation.allocated, 0), 0))
      filter (
        where charge.status <> 'voided'
          and public.hoa_manila_today() - charge.due_date between 61 and 90
      ) as aging_61_90,
    sum(greatest(charge.amount - coalesce(allocation.allocated, 0), 0))
      filter (
        where charge.status <> 'voided'
          and public.hoa_manila_today() - charge.due_date > 90
      ) as aging_90_plus,
    sum(charge.amount) filter (
      where charge.status <> 'voided' and charge.charge_type = 'late_penalty'
    ) as penalty_charges
  from public.homeowner_charges charge
  left join active_allocations allocation on allocation.charge_id = charge.id
  group by charge.property_id
),
payment_totals as (
  select
    payment.property_id,
    sum(coalesce(payment.amount_paid, payment.amount, 0)) as dues_collected,
    max(payment.paid_at) as last_dues_payment_at
  from public.payments payment
  where lower(coalesce(payment.status, 'completed')) <> 'voided'
    and payment.property_id is not null
  group by payment.property_id
),
service_totals as (
  select
    transaction.property_id,
    sum(transaction.amount_due) as service_assessed,
    sum(transaction.amount_paid) as service_collected,
    sum(greatest(transaction.amount_due - transaction.amount_paid, 0))
      as service_outstanding,
    max(transaction.paid_at) as last_service_payment_at
  from public.service_transactions transaction
  where transaction.property_id is not null
    and lower(coalesce(transaction.payment_status, 'paid')) <> 'voided'
  group by transaction.property_id
),
adjustment_totals as (
  select property_id, sum(balance_effect) as net_adjustments
  from public.account_adjustments
  where reversed_at is null
  group by property_id
)
select
  property.id as property_id,
  property.homeowner_name,
  property.block,
  property.lot_number,
  coalesce(charge.assessed, 0) + coalesce(service.service_assessed, 0)
    as total_assessed,
  coalesce(payment.dues_collected, 0) as dues_collected,
  coalesce(service.service_collected, 0) as service_collected,
  coalesce(payment.dues_collected, 0) + coalesce(service.service_collected, 0)
    as total_collected,
  greatest(
    coalesce(charge.assessed, 0)
      - coalesce(charge.allocated, 0)
      + coalesce(service.service_outstanding, 0)
      + coalesce(adjustment.net_adjustments, 0),
    0
  ) as outstanding_balance,
  coalesce(charge.penalty_charges, 0) as penalty_charges,
  coalesce(charge.current_bucket, 0) + coalesce(service.service_outstanding, 0)
    as aging_current,
  coalesce(charge.aging_1_30, 0) as aging_1_30,
  coalesce(charge.aging_31_60, 0) as aging_31_60,
  coalesce(charge.aging_61_90, 0) as aging_61_90,
  coalesce(charge.aging_90_plus, 0) as aging_90_plus,
  greatest(payment.last_dues_payment_at, service.last_service_payment_at)
    as last_payment_at,
  case
    when greatest(
      coalesce(charge.assessed, 0) - coalesce(charge.allocated, 0)
        + coalesce(service.service_outstanding, 0)
        + coalesce(adjustment.net_adjustments, 0),
      0
    ) = 0 then 'Paid'
    when coalesce(charge.aging_1_30, 0) + coalesce(charge.aging_31_60, 0)
      + coalesce(charge.aging_61_90, 0) + coalesce(charge.aging_90_plus, 0) > 0
      then 'Overdue'
    when coalesce(payment.dues_collected, 0) + coalesce(service.service_collected, 0) > 0
      then 'Partial'
    else 'Pending'
  end as account_status
from public.properties property
left join charge_totals charge on charge.property_id = property.id
left join payment_totals payment on payment.property_id = property.id
left join service_totals service on service.property_id = property.id
left join adjustment_totals adjustment on adjustment.property_id = property.id;

create or replace view public.homeowner_statement_lines
with (security_invoker = true)
as
select
  charge.property_id,
  charge.id::text as source_id,
  charge.posted_at as occurred_at,
  'charge'::text as entry_type,
  charge.description,
  charge.amount as debit,
  0::numeric as credit,
  charge.approval_reference as reference
from public.homeowner_charges charge
where charge.status <> 'voided'
union all
select
  payment.property_id,
  payment.id::text,
  payment.paid_at,
  'payment',
  coalesce(payment.coverage_period, 'Payment received'),
  0::numeric,
  coalesce(payment.amount_paid, payment.amount, 0),
  payment.receipt_number
from public.payments payment
where lower(coalesce(payment.status, 'completed')) <> 'voided'
  and payment.property_id is not null
union all
select
  adjustment.property_id,
  adjustment.id::text,
  adjustment.created_at,
  'adjustment',
  adjustment.reason,
  greatest(adjustment.balance_effect, 0),
  greatest(-adjustment.balance_effect, 0),
  adjustment.approval_reference
from public.account_adjustments adjustment
where adjustment.reversed_at is null
union all
select
  transaction.property_id,
  transaction.id::text || '-charge',
  transaction.paid_at,
  'service_charge',
  transaction.service_name,
  transaction.amount_due,
  0::numeric,
  transaction.receipt_number
from public.service_transactions transaction
where transaction.property_id is not null
  and lower(coalesce(transaction.payment_status, 'paid')) <> 'voided'
union all
select
  transaction.property_id,
  transaction.id::text || '-payment',
  transaction.paid_at,
  'service_payment',
  transaction.service_name || ' payment',
  0::numeric,
  transaction.amount_paid,
  transaction.receipt_number
from public.service_transactions transaction
where transaction.property_id is not null
  and lower(coalesce(transaction.payment_status, 'paid')) <> 'voided';

create or replace function public.hoa_require_finance_staff()
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  actor_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  actor_role := public.current_user_role();
  if actor_role is null
    or actor_role <> all (array['admin'::text, 'secretary'::text, 'treasurer'::text])
  then
    raise exception 'An active Admin, Secretary, or Treasurer account is required.';
  end if;
  return actor_role;
end;
$$;

create or replace function public.approve_assessment_schedule(
  p_schedule_id uuid,
  p_board_resolution_reference text,
  p_approved_at timestamptz default now()
)
returns public.assessment_schedules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  result public.assessment_schedules%rowtype;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may activate an assessment schedule.';
  end if;
  if length(trim(coalesce(p_board_resolution_reference, ''))) = 0 then
    raise exception 'A board resolution or governing-document reference is required.';
  end if;

  update public.assessment_schedules
  set board_resolution_reference = trim(p_board_resolution_reference),
      approved_at = p_approved_at,
      approved_by = auth.uid(),
      is_approved = true,
      is_active = true,
      updated_at = now()
  where id = p_schedule_id
  returning * into result;

  if result.id is null then
    raise exception 'Assessment schedule not found.';
  end if;
  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Assessment Schedule Approved',
    result.name || ' — ' || result.board_resolution_reference
  );
  return result;
end;
$$;

create or replace function public.create_assessment_schedule(
  p_name text,
  p_charge_type text,
  p_amount numeric,
  p_frequency text,
  p_effective_from date,
  p_board_resolution_reference text,
  p_due_day smallint default 5,
  p_grace_period_days smallint default 0,
  p_late_penalty numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  schedule_row public.assessment_schedules%rowtype;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may create an assessment schedule.';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0
    or length(trim(coalesce(p_board_resolution_reference, ''))) = 0
  then
    raise exception 'A schedule name and board resolution reference are required.';
  end if;
  if p_amount < 0 or p_due_day not between 1 and 28
    or p_grace_period_days not between 0 and 90 or p_late_penalty < 0
  then
    raise exception 'The schedule amount, due day, grace period, or penalty is invalid.';
  end if;

  update public.assessment_schedules
  set effective_to = p_effective_from - 1,
      is_active = false,
      updated_at = now()
  where charge_type = p_charge_type
    and frequency = p_frequency
    and is_active
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);

  insert into public.assessment_schedules (
    name, charge_type, amount, frequency, effective_from, due_day,
    grace_period_days, late_penalty, board_resolution_reference,
    approved_at, approved_by, is_approved, is_active, created_by
  )
  values (
    trim(p_name), p_charge_type, p_amount, p_frequency, p_effective_from,
    p_due_day, p_grace_period_days, p_late_penalty,
    trim(p_board_resolution_reference), now(), auth.uid(), true, true, auth.uid()
  )
  returning * into schedule_row;

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Assessment Schedule Created',
    schedule_row.name || ' — ' || schedule_row.board_resolution_reference
  );

  return to_jsonb(schedule_row);
end;
$$;

create or replace function public.post_monthly_assessments(
  p_period date default public.hoa_manila_today()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  period_start date := date_trunc('month', p_period)::date;
  inserted_count integer := 0;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may post assessments.';
  end if;

  if exists (
    select 1 from public.accounting_periods
    where status = 'closed'
      and period_start between starts_on and ends_on
  ) then
    raise exception 'This accounting period is closed.';
  end if;

  insert into public.homeowner_charges (
    property_id,
    ownership_id,
    schedule_id,
    fund_id,
    charge_type,
    description,
    period_start,
    due_date,
    amount,
    approval_reference,
    posted_by
  )
  select
    property.id,
    ownership.id,
    schedule.id,
    (select id from public.funds where code = 'OPERATING'),
    schedule.charge_type,
    schedule.name || ' — ' || to_char(period_start, 'Mon YYYY'),
    period_start,
    (period_start + (schedule.due_day - 1))::date,
    schedule.amount,
    schedule.board_resolution_reference,
    auth.uid()
  from public.properties property
  join public.property_ownerships ownership
    on ownership.property_id = property.id
   and ownership.ends_on is null
  cross join public.assessment_schedules schedule
  where schedule.frequency = 'monthly'
    and schedule.is_active
    and schedule.is_approved
    and schedule.amount > 0
    and schedule.effective_from <= period_start
    and (schedule.effective_to is null or schedule.effective_to >= period_start)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Monthly Assessments Posted',
    to_char(period_start, 'Mon YYYY') || ' — ' || inserted_count || ' charge(s)'
  );
  return inserted_count;
end;
$$;

create or replace function public.post_due_penalties(
  p_as_of date default public.hoa_manila_today()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  inserted_count integer := 0;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may post penalties.';
  end if;

  insert into public.homeowner_charges (
    property_id,
    ownership_id,
    schedule_id,
    fund_id,
    charge_type,
    description,
    period_start,
    due_date,
    amount,
    parent_charge_id,
    approval_reference,
    posted_by
  )
  select
    charge.property_id,
    charge.ownership_id,
    charge.schedule_id,
    charge.fund_id,
    'late_penalty',
    'Late penalty — ' || charge.description,
    charge.period_start,
    p_as_of,
    schedule.late_penalty,
    charge.id,
    schedule.board_resolution_reference,
    auth.uid()
  from public.homeowner_charges charge
  join public.assessment_schedules schedule on schedule.id = charge.schedule_id
  left join (
    select charge_id, sum(amount) as allocated
    from public.payment_allocations
    where reversed_at is null
    group by charge_id
  ) allocation on allocation.charge_id = charge.id
  where charge.status <> 'voided'
    and charge.charge_type = 'regular_dues'
    and schedule.is_active
    and schedule.is_approved
    and schedule.late_penalty > 0
    and p_as_of > charge.due_date + schedule.grace_period_days
    and charge.amount > coalesce(allocation.allocated, 0)
  on conflict do nothing;

  get diagnostics inserted_count = row_count;
  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Late Penalties Posted',
    to_char(p_as_of, 'YYYY-MM-DD') || ' — ' || inserted_count || ' charge(s)'
  );
  return inserted_count;
end;
$$;

create or replace function public.record_hoa_payment(
  p_property_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text default null,
  p_note text default null,
  p_payment_purpose text default 'Association Dues',
  p_coverage_period text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  property_row public.properties%rowtype;
  payment_row public.payments%rowtype;
  previous_balance numeric(12, 2);
  remaining_to_allocate numeric(12, 2);
  charge_row record;
  allocation_amount numeric(12, 2);
begin
  actor_role := public.hoa_require_finance_staff();
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if length(trim(coalesce(p_payment_method, ''))) = 0 then
    raise exception 'Payment method is required.';
  end if;
  if lower(trim(p_payment_method)) <> 'cash'
    and length(trim(coalesce(p_reference_number, ''))) = 0
  then
    raise exception 'A reference number is required for non-cash payments.';
  end if;

  select * into property_row
  from public.properties
  where id = p_property_id
  for update;

  if property_row.id is null then
    raise exception 'Property not found.';
  end if;

  select outstanding_balance into previous_balance
  from public.homeowner_ledger_summary
  where property_id = p_property_id;
  previous_balance := coalesce(previous_balance, 0);

  insert into public.payments (
    property_id,
    homeowner_name,
    block_name,
    lot_number,
    coverage_period,
    previous_balance,
    amount,
    amount_paid,
    payment_method,
    reference_number,
    note,
    recorded_by,
    recorded_by_name
  )
  values (
    property_row.id,
    property_row.homeowner_name,
    property_row.block,
    property_row.lot_number::text,
    trim(concat_ws(' — ', nullif(trim(p_payment_purpose), ''), nullif(trim(p_coverage_period), ''))),
    previous_balance,
    p_amount,
    p_amount,
    p_payment_method,
    nullif(trim(p_reference_number), ''),
    nullif(trim(p_note), ''),
    auth.uid(),
    coalesce(
      (select full_name from public.profiles where id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'Staff member'
    )
  )
  returning * into payment_row;

  remaining_to_allocate := p_amount;
  for charge_row in
    select
      charge.id,
      charge.amount - coalesce(sum(allocation.amount) filter (
        where allocation.reversed_at is null
      ), 0) as open_amount
    from public.homeowner_charges charge
    left join public.payment_allocations allocation on allocation.charge_id = charge.id
    where charge.property_id = p_property_id
      and charge.status <> 'voided'
    group by charge.id, charge.amount, charge.due_date, charge.posted_at
    having charge.amount > coalesce(sum(allocation.amount) filter (
      where allocation.reversed_at is null
    ), 0)
    order by charge.due_date, charge.posted_at, charge.id
  loop
    exit when remaining_to_allocate <= 0;
    allocation_amount := least(remaining_to_allocate, charge_row.open_amount);

    insert into public.payment_allocations (
      payment_id, charge_id, amount, allocated_by
    )
    values (
      payment_row.id, charge_row.id, allocation_amount, auth.uid()
    );

    remaining_to_allocate := remaining_to_allocate - allocation_amount;
  end loop;

  update public.homeowner_charges charge
  set status = case
    when coalesce(allocation.allocated, 0) >= charge.amount then 'paid'
    when coalesce(allocation.allocated, 0) > 0 then 'partial'
    else 'open'
  end
  from (
    select charge_id, sum(amount) as allocated
    from public.payment_allocations
    where reversed_at is null
    group by charge_id
  ) allocation
  where charge.id = allocation.charge_id
    and charge.property_id = p_property_id
    and charge.status <> 'voided';

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Payment Recorded',
    payment_row.receipt_number || ' — ' || property_row.homeowner_name ||
      ' — PHP ' || to_char(p_amount, 'FM999999999990.00')
  );

  return to_jsonb(payment_row) || jsonb_build_object(
    'allocated_amount', p_amount - remaining_to_allocate,
    'unallocated_amount', remaining_to_allocate
  );
end;
$$;

create or replace function public.void_hoa_payment(
  p_payment_id bigint,
  p_reason text,
  p_approval_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  payment_row public.payments%rowtype;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may void a payment.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5
    or length(trim(coalesce(p_approval_reference, ''))) = 0
  then
    raise exception 'A reason and approval reference are required.';
  end if;

  select * into payment_row
  from public.payments
  where id = p_payment_id
  for update;

  if payment_row.id is null then
    raise exception 'Payment not found.';
  end if;
  if lower(coalesce(payment_row.status, '')) = 'voided' then
    raise exception 'Payment is already voided.';
  end if;

  update public.payments
  set status = 'Voided'
  where id = p_payment_id
  returning * into payment_row;

  update public.payment_allocations
  set reversed_at = now(),
      reversed_by = auth.uid(),
      reversal_reason = trim(p_reason) || ' [' || trim(p_approval_reference) || ']'
  where payment_id = p_payment_id
    and reversed_at is null;

  update public.homeowner_charges charge
  set status = case
    when coalesce(allocation.allocated, 0) >= charge.amount then 'paid'
    when coalesce(allocation.allocated, 0) > 0 then 'partial'
    else 'open'
  end
  from (
    select
      target.id as charge_id,
      coalesce(sum(allocation.amount) filter (
        where allocation.reversed_at is null
      ), 0) as allocated
    from public.homeowner_charges target
    left join public.payment_allocations allocation on allocation.charge_id = target.id
    group by target.id
  ) allocation
  where charge.id = allocation.charge_id;

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Payment Voided',
    payment_row.receipt_number || ' — ' || trim(p_reason) ||
      ' [' || trim(p_approval_reference) || ']'
  );

  return to_jsonb(payment_row);
end;
$$;

create or replace function public.record_account_adjustment(
  p_property_id bigint,
  p_charge_id uuid,
  p_adjustment_type text,
  p_balance_effect numeric,
  p_reason text,
  p_approval_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  adjustment_row public.account_adjustments%rowtype;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may record an adjustment.';
  end if;
  if p_balance_effect = 0
    or length(trim(coalesce(p_reason, ''))) < 5
    or length(trim(coalesce(p_approval_reference, ''))) = 0
  then
    raise exception 'A non-zero amount, clear reason, and approval reference are required.';
  end if;
  if p_charge_id is not null and not exists (
    select 1 from public.homeowner_charges
    where id = p_charge_id and property_id = p_property_id
  ) then
    raise exception 'The selected charge does not belong to this property.';
  end if;

  insert into public.account_adjustments (
    property_id, charge_id, adjustment_type, balance_effect,
    reason, approval_reference, created_by
  )
  values (
    p_property_id, p_charge_id, p_adjustment_type, p_balance_effect,
    trim(p_reason), trim(p_approval_reference), auth.uid()
  )
  returning * into adjustment_row;

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Account Adjustment Recorded',
    adjustment_row.adjustment_type || ' — PHP ' ||
      to_char(abs(adjustment_row.balance_effect), 'FM999999999990.00') ||
      ' [' || adjustment_row.approval_reference || ']'
  );

  return to_jsonb(adjustment_row);
end;
$$;

create or replace function public.close_accounting_period(
  p_starts_on date,
  p_ends_on date,
  p_note text
)
returns public.accounting_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  result public.accounting_periods%rowtype;
begin
  actor_role := public.hoa_require_finance_staff();
  if actor_role not in ('admin', 'treasurer') then
    raise exception 'Only an Admin or Treasurer may close an accounting period.';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'The period end cannot be before its start.';
  end if;

  insert into public.accounting_periods (
    starts_on, ends_on, status, closed_at, closed_by, close_note
  )
  values (
    p_starts_on, p_ends_on, 'closed', now(), auth.uid(), nullif(trim(p_note), '')
  )
  on conflict (starts_on, ends_on)
  do update set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    close_note = excluded.close_note
  returning * into result;

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Accounting Period Closed',
    to_char(p_starts_on, 'YYYY-MM-DD') || ' to ' || to_char(p_ends_on, 'YYYY-MM-DD')
  );
  return result;
end;
$$;

alter table public.property_ownerships enable row level security;
alter table public.assessment_schedules enable row level security;
alter table public.homeowner_charges enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.account_adjustments enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.funds enable row level security;
alter table public.bank_deposits enable row level security;
alter table public.bank_deposit_receipts enable row level security;
alter table public.collection_actions enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'property_ownerships', 'assessment_schedules', 'homeowner_charges',
    'payment_allocations', 'account_adjustments', 'accounting_periods',
    'funds', 'bank_deposits', 'bank_deposit_receipts', 'collection_actions'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'HOA staff can read ' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_user_role() = any (array[''admin''::text, ''secretary''::text, ''treasurer''::text]))',
      'HOA staff can read ' || table_name,
      table_name
    );
  end loop;
end $$;

create policy "Finance officers can manage schedules"
on public.assessment_schedules for all to authenticated
using (public.current_user_role() = any (array['admin'::text, 'treasurer'::text]))
with check (public.current_user_role() = any (array['admin'::text, 'treasurer'::text]));

create policy "Staff can record collection actions"
on public.collection_actions for insert to authenticated
with check (
  public.current_user_role() = any (
    array['admin'::text, 'secretary'::text, 'treasurer'::text]
  )
  and created_by = auth.uid()
);

grant select on public.property_ownerships, public.assessment_schedules,
  public.homeowner_charges, public.payment_allocations,
  public.account_adjustments, public.accounting_periods, public.funds,
  public.bank_deposits, public.bank_deposit_receipts,
  public.collection_actions, public.homeowner_ledger_summary,
  public.homeowner_statement_lines
to authenticated;

grant insert on public.collection_actions to authenticated;

revoke all on function public.approve_assessment_schedule(uuid, text, timestamptz)
  from public, anon;
revoke all on function public.create_assessment_schedule(text, text, numeric, text, date, text, smallint, smallint, numeric)
  from public, anon;
revoke all on function public.post_monthly_assessments(date) from public, anon;
revoke all on function public.post_due_penalties(date) from public, anon;
revoke all on function public.record_hoa_payment(bigint, numeric, text, text, text, text, text)
  from public, anon;
revoke all on function public.void_hoa_payment(bigint, text, text) from public, anon;
revoke all on function public.record_account_adjustment(bigint, uuid, text, numeric, text, text)
  from public, anon;
revoke all on function public.close_accounting_period(date, date, text)
  from public, anon;

grant execute on function public.approve_assessment_schedule(uuid, text, timestamptz)
  to authenticated;
grant execute on function public.create_assessment_schedule(text, text, numeric, text, date, text, smallint, smallint, numeric)
  to authenticated;
grant execute on function public.post_monthly_assessments(date) to authenticated;
grant execute on function public.post_due_penalties(date) to authenticated;
grant execute on function public.record_hoa_payment(bigint, numeric, text, text, text, text, text)
  to authenticated;
grant execute on function public.void_hoa_payment(bigint, text, text) to authenticated;
grant execute on function public.record_account_adjustment(bigint, uuid, text, numeric, text, text)
  to authenticated;
grant execute on function public.close_accounting_period(date, date, text)
  to authenticated;

comment on table public.homeowner_charges is
  'Permanent dated assessments and fees. Corrections use adjustments or void metadata.';
comment on table public.payment_allocations is
  'FIFO links from receipts to charges. Reversals are retained rather than deleted.';
comment on view public.homeowner_ledger_summary is
  'Charge-based homeowner receivables, collections, and aging; excludes voided records.';
comment on function public.post_monthly_assessments(date) is
  'Posts only approved, active schedules and is idempotent per property/schedule/period.';