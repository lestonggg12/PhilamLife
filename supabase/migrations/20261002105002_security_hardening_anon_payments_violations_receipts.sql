-- 1. Anonymous (not signed-in) visitors get no direct table/sequence access. RLS already blocks them; this is defense in depth.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 2. Violations policies should only apply to signed-in users (same conditions as before).
alter policy "Admin and Secretary can log violations" on public.violations to authenticated;
alter policy "Admin, Secretary and Treasurer can view violations" on public.violations to authenticated;
alter policy "Admin and Secretary can update violations" on public.violations to authenticated;

-- 3. Receipt-number generator is callable only by active staff (was: any signed-in user).
create or replace function public.next_service_receipt_number()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform public.hoa_require_finance_staff();
  return 'SR-' ||
    to_char(timezone('Asia/Manila', now()), 'YYYY') ||
    '-' ||
    lpad(nextval('public.service_receipt_sequence')::text, 6, '0');
end;
$$;
revoke execute on function public.next_service_receipt_number() from public, anon;
grant execute on function public.next_service_receipt_number() to authenticated;

-- 4. Payments are a financial record: staff may change status/note (e.g. void) but never the money,
--    receipt, owner, or audit fields after the fact. Direct SQL (no auth.uid()) is unaffected.
create or replace function public.protect_payment_financial_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.id := old.id;
  new.property_id := old.property_id;
  new.amount := old.amount;
  new.amount_paid := old.amount_paid;
  new.previous_balance := old.previous_balance;
  new.remaining_balance := old.remaining_balance;
  new.receipt_number := old.receipt_number;
  new.paid_at := old.paid_at;
  new.payment_date := old.payment_date;
  new.created_at := old.created_at;
  new.recorded_by := old.recorded_by;
  new.recorded_by_name := old.recorded_by_name;
  new.homeowner_name := old.homeowner_name;
  new.block_name := old.block_name;
  new.lot_number := old.lot_number;
  new.coverage_period := old.coverage_period;
  new.payment_method := old.payment_method;
  new.reference_number := old.reference_number;
  return new;
end;
$$;
revoke execute on function public.protect_payment_financial_fields() from public, anon, authenticated;

drop trigger if exists protect_payment_financial_fields on public.payments;
create trigger protect_payment_financial_fields
  before update on public.payments
  for each row execute function public.protect_payment_financial_fields();
