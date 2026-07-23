-- Run once in Supabase > SQL Editor.
-- Services are visible to all active staff, but only Secretaries may manage
-- the catalog and record service payments.

create extension if not exists pgcrypto;

create sequence if not exists public.service_receipt_sequence start 1;

create table if not exists public.amenity_services (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  description text,
  rate numeric(12, 2) not null default 0 check (rate >= 0),
  rate_unit text not null default 'per use'
    check (rate_unit in ('per use', 'per hour', 'per person', 'per day')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.next_service_receipt_number()
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select
    'SR-' ||
    to_char(timezone('Asia/Manila', now()), 'YYYY') ||
    '-' ||
    lpad(nextval('public.service_receipt_sequence')::text, 6, '0');
$$;

create table if not exists public.service_transactions (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique
    default public.next_service_receipt_number(),
  service_id uuid not null references public.amenity_services(id),
  service_name text not null check (length(trim(service_name)) > 0),
  customer_name text not null check (length(trim(customer_name)) > 0),
  block_name text not null check (length(trim(block_name)) > 0),
  lot_number text not null check (length(trim(lot_number)) > 0),
  service_date date not null,
  start_time time,
  quantity integer not null default 1 check (quantity > 0),
  amount_due numeric(12, 2) not null check (amount_due > 0),
  amount_paid numeric(12, 2) not null check (amount_paid > 0),
  payment_method text not null
    check (payment_method in ('Cash', 'GCash', 'Bank Transfer', 'Check')),
  reference_number text,
  notes text,
  payment_status text not null
    check (
      (payment_status = 'paid' and amount_paid >= amount_due)
      or
      (payment_status = 'partial' and amount_paid < amount_due)
    ),
  recorded_by uuid not null references auth.users(id),
  recorded_by_name text not null check (length(trim(recorded_by_name)) > 0),
  paid_at timestamptz not null default now()
);

create index if not exists service_transactions_paid_at_idx
  on public.service_transactions (paid_at desc);

create index if not exists service_transactions_service_id_idx
  on public.service_transactions (service_id);

create or replace function public.protect_amenity_service_audit_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists protect_amenity_service_audit_fields
  on public.amenity_services;

create trigger protect_amenity_service_audit_fields
before update on public.amenity_services
for each row
execute function public.protect_amenity_service_audit_fields();

insert into public.amenity_services (name, description, rate, rate_unit)
values
  ('Swimming Pool', 'Use of the village swimming pool.', 0, 'per person'),
  ('Function Hall', 'Reservation of the village function hall.', 0, 'per use'),
  ('Basketball Court', 'Reservation of the village basketball court.', 0, 'per hour'),
  ('Sports Court', 'Reservation of the village multipurpose sports court.', 0, 'per hour')
on conflict (name) do nothing;

alter table public.amenity_services enable row level security;
alter table public.service_transactions enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('amenity_services', 'service_transactions')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end $$;

create policy "Staff can view amenity services"
on public.amenity_services
for select
to authenticated
using (
  public.current_user_role() = any (
    array['admin'::text, 'secretary'::text, 'treasurer'::text]
  )
);

create policy "Secretary can create amenity services"
on public.amenity_services
for insert
to authenticated
with check (
  public.current_user_role() = 'secretary'
  and created_by = auth.uid()
);

create policy "Secretary can update amenity services"
on public.amenity_services
for update
to authenticated
using (public.current_user_role() = 'secretary')
with check (public.current_user_role() = 'secretary');

create policy "Staff can view service transactions"
on public.service_transactions
for select
to authenticated
using (
  public.current_user_role() = any (
    array['admin'::text, 'secretary'::text, 'treasurer'::text]
  )
);

create policy "Secretary can record service transactions"
on public.service_transactions
for insert
to authenticated
with check (
  public.current_user_role() = 'secretary'
  and recorded_by = auth.uid()
);

-- No UPDATE or DELETE policy is created for service_transactions.
-- Issued service receipts remain immutable for the financial audit trail.

grant usage on sequence public.service_receipt_sequence to authenticated;
grant select, insert, update on public.amenity_services to authenticated;
grant select, insert on public.service_transactions to authenticated;
