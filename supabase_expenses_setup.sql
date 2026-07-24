-- Run once in Supabase > SQL Editor.
-- Creates or upgrades the Treasurer expense ledger and its role-based access.

create extension if not exists pgcrypto;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (length(trim(category)) > 0),
  description text not null check (length(trim(description)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  reference_number text,
  recorded_by uuid not null references auth.users(id),
  recorded_by_name text not null check (length(trim(recorded_by_name)) > 0),
  status text not null default 'Completed'
    check (status in ('Completed', 'Recorded', 'Voided')),
  created_at timestamptz not null default now()
);

alter table public.expenses
  add column if not exists status text;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table public.expenses drop constraint if exists %I',
      constraint_row.conname
    );
  end loop;
end $$;

update public.expenses
set status = 'Completed'
where status is null
   or status not in ('Completed', 'Recorded', 'Voided');

alter table public.expenses
  alter column status set default 'Completed',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_status_check'
  ) then
    alter table public.expenses
      add constraint expenses_status_check
      check (status in ('Completed', 'Recorded', 'Voided'));
  end if;
end $$;

create index if not exists expenses_date_idx
  on public.expenses (expense_date desc);

create index if not exists expenses_status_idx
  on public.expenses (status);

create or replace function public.protect_expense_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.id := old.id;
  new.expense_date := old.expense_date;
  new.category := old.category;
  new.description := old.description;
  new.amount := old.amount;
  new.reference_number := old.reference_number;
  new.recorded_by := old.recorded_by;
  new.recorded_by_name := old.recorded_by_name;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists protect_expense_audit_fields
  on public.expenses;

create trigger protect_expense_audit_fields
before update on public.expenses
for each row
execute function public.protect_expense_audit_fields();

alter table public.expenses enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'expenses'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end $$;

create policy "Admin and Treasurer can view expenses"
on public.expenses
for select
to authenticated
using (
  public.current_user_role() = any (
    array['admin'::text, 'treasurer'::text]
  )
);

create policy "Treasurer can record expenses"
on public.expenses
for insert
to authenticated
with check (
  public.current_user_role() = 'treasurer'
  and recorded_by = auth.uid()
  and status in ('Completed', 'Recorded')
);

create policy "Treasurer can void expenses"
on public.expenses
for update
to authenticated
using (
  public.current_user_role() = 'treasurer'
  and status in ('Completed', 'Recorded')
)
with check (
  public.current_user_role() = 'treasurer'
  and status = 'Voided'
);

grant select, insert, update on public.expenses to authenticated;
