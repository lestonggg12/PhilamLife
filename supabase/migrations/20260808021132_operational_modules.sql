-- PhilamLife operational modules
-- Adds real, queryable data sources for what the Monthly Report previously
-- showed as N/A: fund cash balances, maintenance requests, violations,
-- security incidents, capital projects, and board action items.
-- Non-destructive: every table starts empty, nothing is backfilled or
-- invented — figures become real the moment staff start using the module.

-- ============================================================
-- 1. FUND TRANSACTIONS (cash & reserve fund balances)
-- ============================================================
create table if not exists public.fund_transactions (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references public.funds(id) on delete restrict,
  transaction_type text not null check (
    transaction_type in ('deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'interest', 'adjustment')
  ),
  amount numeric(12, 2) not null check (amount > 0),
  transaction_date date not null default public.hoa_manila_today(),
  reference_number text,
  description text not null check (length(trim(description)) > 0),
  status text not null default 'Completed' check (status in ('Completed', 'Voided')),
  recorded_by uuid not null references auth.users(id),
  recorded_by_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists fund_transactions_fund_idx on public.fund_transactions (fund_id, transaction_date);

alter table public.fund_transactions enable row level security;

create policy "Admin and Treasurer can view fund transactions"
  on public.fund_transactions for select
  using (public.current_user_role() = any (array['admin', 'treasurer']));

create policy "Treasurer can record fund transactions"
  on public.fund_transactions for insert
  with check (public.current_user_role() = any (array['admin', 'treasurer']) and recorded_by = auth.uid());

create policy "Treasurer can void fund transactions"
  on public.fund_transactions for update
  using (public.current_user_role() = any (array['admin', 'treasurer']) and status = 'Completed')
  with check (public.current_user_role() = any (array['admin', 'treasurer']) and status = 'Voided');

create or replace view public.fund_balances
with (security_invoker = true)
as
select
  fund.id as fund_id,
  fund.code,
  fund.name,
  fund.fund_type,
  coalesce(sum(txn.amount) filter (
    where txn.status = 'Completed' and txn.transaction_type in ('deposit', 'transfer_in', 'interest')
  ), 0)
  - coalesce(sum(txn.amount) filter (
    where txn.status = 'Completed' and txn.transaction_type in ('withdrawal', 'transfer_out')
  ), 0)
  + coalesce(sum(txn.amount) filter (
    where txn.status = 'Completed' and txn.transaction_type = 'adjustment'
  ), 0) as balance
from public.funds fund
left join public.fund_transactions txn on txn.fund_id = fund.id
group by fund.id, fund.code, fund.name, fund.fund_type;

-- ============================================================
-- 2. MAINTENANCE REQUESTS
-- ============================================================
create table if not exists public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  property_id bigint references public.properties(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  category text not null default 'Routine Maintenance'
    check (category in ('Emergency Repair', 'Routine Maintenance', 'Preventive Maintenance', 'Other')),
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Completed', 'Cancelled')),
  requested_by_name text,
  reported_at timestamptz not null default now(),
  completed_at timestamptz,
  cost numeric(12, 2),
  notes text,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maintenance_requests_status_idx on public.maintenance_requests (status);

alter table public.maintenance_requests enable row level security;

create policy "Admin, Secretary and Treasurer can view maintenance requests"
  on public.maintenance_requests for select
  using (public.current_user_role() = any (array['admin', 'secretary', 'treasurer']));

create policy "Admin and Secretary can log maintenance requests"
  on public.maintenance_requests for insert
  with check (public.current_user_role() = any (array['admin', 'secretary']) and created_by = auth.uid());

create policy "Admin and Secretary can update maintenance requests"
  on public.maintenance_requests for update
  using (public.current_user_role() = any (array['admin', 'secretary']))
  with check (public.current_user_role() = any (array['admin', 'secretary']));

-- ============================================================
-- 3. VIOLATIONS & COMPLIANCE
-- ============================================================
create table if not exists public.violations (
  id uuid primary key default gen_random_uuid(),
  property_id bigint references public.properties(id) on delete set null,
  category text not null default 'Other'
    check (category in ('Property Maintenance', 'Parking', 'Noise', 'Architectural', 'Other')),
  description text not null check (length(trim(description)) > 0),
  status text not null default 'Open' check (status in ('Open', 'Resolved', 'Dismissed')),
  fine_amount numeric(12, 2) default 0 check (fine_amount >= 0),
  fine_collected boolean not null default false,
  date_issued date not null default public.hoa_manila_today(),
  date_resolved date,
  notes text,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists violations_status_idx on public.violations (status);

alter table public.violations enable row level security;

create policy "Admin, Secretary and Treasurer can view violations"
  on public.violations for select
  using (public.current_user_role() = any (array['admin', 'secretary', 'treasurer']));

create policy "Admin and Secretary can log violations"
  on public.violations for insert
  with check (public.current_user_role() = any (array['admin', 'secretary']) and created_by = auth.uid());

create policy "Admin and Secretary can update violations"
  on public.violations for update
  using (public.current_user_role() = any (array['admin', 'secretary']))
  with check (public.current_user_role() = any (array['admin', 'secretary']));

-- ============================================================
-- 4. SECURITY INCIDENTS
-- ============================================================
create table if not exists public.security_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_date timestamptz not null default now(),
  incident_type text not null default 'Other'
    check (incident_type in ('Trespassing', 'Theft', 'Vandalism', 'Disturbance', 'Vehicle', 'Fire/Safety', 'Other')),
  location text,
  status text not null default 'Open' check (status in ('Open', 'Under Investigation', 'Resolved')),
  description text not null check (length(trim(description)) > 0),
  action_taken text,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists security_incidents_date_idx on public.security_incidents (incident_date);

alter table public.security_incidents enable row level security;

create policy "Admin, Secretary and Treasurer can view security incidents"
  on public.security_incidents for select
  using (public.current_user_role() = any (array['admin', 'secretary', 'treasurer']));

create policy "Admin and Secretary can log security incidents"
  on public.security_incidents for insert
  with check (public.current_user_role() = any (array['admin', 'secretary']) and created_by = auth.uid());

create policy "Admin and Secretary can update security incidents"
  on public.security_incidents for update
  using (public.current_user_role() = any (array['admin', 'secretary']))
  with check (public.current_user_role() = any (array['admin', 'secretary']));

-- ============================================================
-- 5. CAPITAL PROJECTS
-- ============================================================
create table if not exists public.capital_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text,
  budget numeric(12, 2) check (budget >= 0),
  spent numeric(12, 2) not null default 0 check (spent >= 0),
  status text not null default 'Planned' check (status in ('Planned', 'In Progress', 'Completed', 'On Hold', 'Cancelled')),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  started_on date,
  expected_completion date,
  completed_on date,
  notes text,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists capital_projects_status_idx on public.capital_projects (status);

alter table public.capital_projects enable row level security;

create policy "Admin and Treasurer can view capital projects"
  on public.capital_projects for select
  using (public.current_user_role() = any (array['admin', 'treasurer']));

create policy "Admin and Treasurer can log capital projects"
  on public.capital_projects for insert
  with check (public.current_user_role() = any (array['admin', 'treasurer']) and created_by = auth.uid());

create policy "Admin and Treasurer can update capital projects"
  on public.capital_projects for update
  using (public.current_user_role() = any (array['admin', 'treasurer']))
  with check (public.current_user_role() = any (array['admin', 'treasurer']));

-- ============================================================
-- 6. BOARD ACTION ITEMS
-- ============================================================
create table if not exists public.board_action_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  responsible_party text,
  due_date date,
  status text not null default 'Open' check (status in ('Open', 'In Progress', 'Completed', 'Deferred')),
  notes text,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_action_items_status_idx on public.board_action_items (status);

alter table public.board_action_items enable row level security;

create policy "Admin, Secretary and Treasurer can view board action items"
  on public.board_action_items for select
  using (public.current_user_role() = any (array['admin', 'secretary', 'treasurer']));

create policy "Admin can log board action items"
  on public.board_action_items for insert
  with check (public.current_user_role() = 'admin' and created_by = auth.uid());

create policy "Admin can update board action items"
  on public.board_action_items for update
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ============================================================
-- updated_at maintenance trigger (shared)
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists maintenance_requests_set_updated_at on public.maintenance_requests;
create trigger maintenance_requests_set_updated_at
before update on public.maintenance_requests
for each row execute function public.set_updated_at();

drop trigger if exists violations_set_updated_at on public.violations;
create trigger violations_set_updated_at
before update on public.violations
for each row execute function public.set_updated_at();

drop trigger if exists security_incidents_set_updated_at on public.security_incidents;
create trigger security_incidents_set_updated_at
before update on public.security_incidents
for each row execute function public.set_updated_at();

drop trigger if exists capital_projects_set_updated_at on public.capital_projects;
create trigger capital_projects_set_updated_at
before update on public.capital_projects
for each row execute function public.set_updated_at();

drop trigger if exists board_action_items_set_updated_at on public.board_action_items;
create trigger board_action_items_set_updated_at
before update on public.board_action_items
for each row execute function public.set_updated_at();
;
