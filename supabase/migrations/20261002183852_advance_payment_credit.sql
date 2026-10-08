-- Negative current_balance = advance credit
alter table public.properties drop constraint if exists properties_current_balance_check;
alter table public.payments drop constraint if exists payments_amounts_check;
comment on column public.properties.current_balance is
  'Amount owed (positive) or advance credit (negative). Charges add, payments deduct.';

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
    new.previous_balance := bal;
    new.remaining_balance := bal - paid;   -- negative = advance credit
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
    update public.properties set current_balance = current_balance - paid where id = new.property_id;
  end if;
  return new;
end $$;

create or replace function public.apply_charge_to_balance()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;
  elsif old.voided_at is null and new.voided_at is not null then
    update public.properties set current_balance = current_balance - new.amount where id = new.property_id;
  end if;
  return new;
end $$;
