-- 1. Running balance on each property
alter table public.properties
  add column if not exists current_balance numeric(12,2) not null default 0
  check (current_balance >= 0);

update public.properties p
set current_balance = greatest(coalesce((
  select pa.remaining_balance from public.payments pa
  where pa.property_id = p.id and pa.status <> 'Voided'
  order by pa.paid_at desc nulls last, pa.id desc limit 1
), 0), 0);

comment on column public.properties.current_balance is
  'Amount the homeowner currently owes. Maintained by triggers: charges add, payments deduct.';

-- 2. Charges (monthly dues + staff-added penalties/fees)
create table if not exists public.property_charges (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id),
  charge_type text not null check (charge_type in
    ('Association Dues','Special Assessment','Penalty / Late Fee','Sticker / ID Fee','Document / Certification Fee','Other')),
  description text check (description is null or length(btrim(description)) <= 250),
  amount numeric(12,2) not null check (amount > 0),
  billing_month date check (billing_month is null or billing_month = date_trunc('month', billing_month)::date),
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  unique (property_id, billing_month)
);
create index if not exists property_charges_property_idx on public.property_charges(property_id);

alter table public.property_charges enable row level security;

create policy "Staff can view charges" on public.property_charges
  for select to authenticated
  using (public.current_user_role() = any (array['admin','secretary','treasurer']));

create policy "Staff can add manual charges" on public.property_charges
  for insert to authenticated
  with check (
    public.current_user_role() = any (array['admin','secretary','treasurer'])
    and created_by = auth.uid()
    and billing_month is null
    and voided_at is null
  );

grant select, insert on public.property_charges to authenticated;

create or replace function public.apply_charge_to_balance()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;
  elsif old.voided_at is null and new.voided_at is not null then
    update public.properties set current_balance = greatest(current_balance - new.amount, 0) where id = new.property_id;
  end if;
  return new;
end $$;

create trigger apply_charge_to_balance
  after insert or update of voided_at on public.property_charges
  for each row execute function public.apply_charge_to_balance();

-- 3. Payments: server decides the balance and deducts it atomically
create or replace function public.prepare_payment_record()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  bal numeric(12,2);
  paid numeric(12,2);
begin
  if new.paid_at is null then new.paid_at := now(); end if;
  if new.created_at is null then new.created_at := now(); end if;

  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number := 'OR-' || to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);

  if new.property_id is not null then
    select current_balance into bal from public.properties where id = new.property_id for update;
    if not found then raise exception 'Property not found.'; end if;
    if paid > bal then
      raise exception 'Amount paid cannot be greater than the current balance (%).', bal;
    end if;
    new.previous_balance := bal;
    new.remaining_balance := bal - paid;
    update public.properties set current_balance = new.remaining_balance where id = new.property_id;
  else
    new.remaining_balance := new.previous_balance - new.amount_paid;
  end if;

  return new;
end $$;

create or replace function public.sync_balance_on_payment_status()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare paid numeric(12,2) := coalesce(new.amount_paid, new.amount);
begin
  if new.property_id is null then return new; end if;
  if old.status <> 'Voided' and new.status = 'Voided' then
    update public.properties set current_balance = current_balance + paid where id = new.property_id;
  elsif old.status = 'Voided' and new.status <> 'Voided' then
    update public.properties set current_balance = greatest(current_balance - paid, 0) where id = new.property_id;
  end if;
  return new;
end $$;

create trigger sync_balance_on_payment_status
  after update of status on public.payments
  for each row execute function public.sync_balance_on_payment_status();

-- 4. Block direct edits of the balance from the app (triggers above still work)
create or replace function public.protect_property_balance()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    new.current_balance := old.current_balance;
  end if;
  return new;
end $$;

create trigger protect_property_balance
  before update on public.properties
  for each row execute function public.protect_property_balance();

-- 5. Automatic monthly dues
create or replace function public.bill_monthly_dues(p_month date default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare m date; amt numeric; n integer;
begin
  m := date_trunc('month', coalesce(p_month, public.hoa_manila_today()))::date;
  select dues_amount into amt from public.system_settings where id = 1;
  amt := coalesce(amt, 5000);
  if amt <= 0 then return 0; end if;
  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select id, 'Association Dues', to_char(m, 'FMMonth YYYY') || ' monthly dues', amt, m, 'System (automatic)'
  from public.properties where homeowner_status = 'active'
  on conflict (property_id, billing_month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bill_monthly_dues(date) from public, anon, authenticated;

create extension if not exists pg_cron;
-- Daily at 00:05 Manila (16:05 UTC); idempotent. Billing starts with November 2026.
select cron.schedule('bill-monthly-dues', '5 16 * * *',
  $$select public.bill_monthly_dues() where public.hoa_manila_today() >= date '2026-11-01'$$);
