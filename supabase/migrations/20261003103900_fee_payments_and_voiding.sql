-- ===== Payments: purpose-aware balance effect + void tracking =====
alter table public.payments
  add column if not exists charge_type text,
  add column if not exists balance_effect numeric(12,2),
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

comment on column public.payments.charge_type is 'Purpose of the payment. NULL on legacy receipts.';
comment on column public.payments.balance_effect is 'How much this payment reduced current_balance. Dues: the full amount. Fees: only what matched an open charge of the same type. NULL on legacy receipts (= amount_paid).';

create or replace function public.prepare_payment_record()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  bal numeric(12,2);
  paid numeric(12,2);
  ct text;
  charged numeric(12,2);
  applied numeric(12,2);
  effect numeric(12,2);
begin
  if new.paid_at is null then new.paid_at := now(); end if;
  if new.created_at is null then new.created_at := now(); end if;

  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number := 'OR-' || to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);
  ct := coalesce(new.charge_type, 'Association Dues');
  if ct not in ('Association Dues','Special Assessment','Penalty / Late Fee','Sticker / ID Fee','Document / Certification Fee','Other') then
    ct := 'Other';
  end if;
  new.charge_type := ct;

  if new.property_id is not null then
    select current_balance into bal from public.properties where id = new.property_id for update;
    if not found then raise exception 'Property not found.'; end if;

    if ct = 'Association Dues' then
      effect := paid;                       -- dues: whole payment; extra becomes advance credit
    else
      -- fees/penalties: only pays off an open charge of the same type; anything else is a one-time fee
      select coalesce(sum(amount), 0) into charged
        from public.property_charges
        where property_id = new.property_id and charge_type = ct and voided_at is null;
      select coalesce(sum(balance_effect), 0) into applied
        from public.payments
        where property_id = new.property_id and charge_type = ct and status <> 'Voided';
      effect := least(paid, greatest(charged - applied, 0));
    end if;

    new.previous_balance := bal;
    new.balance_effect := effect;
    new.remaining_balance := bal - effect;   -- negative = advance credit
    update public.properties set current_balance = new.remaining_balance where id = new.property_id;
  else
    new.balance_effect := 0;
    new.remaining_balance := new.previous_balance - new.amount_paid;
  end if;

  return new;
end $$;

create or replace function public.sync_balance_on_payment_status()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare effect numeric(12,2) := coalesce(new.balance_effect, new.amount_paid, new.amount);
begin
  if new.property_id is null then return new; end if;
  if old.status <> 'Voided' and new.status = 'Voided' then
    update public.properties set current_balance = current_balance + effect where id = new.property_id;
  elsif old.status = 'Voided' and new.status <> 'Voided' then
    update public.properties set current_balance = current_balance - effect where id = new.property_id;
  end if;
  return new;
end $$;

create or replace function public.protect_payment_financial_fields()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if auth.uid() is null then return new; end if;
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
  new.charge_type := old.charge_type;
  new.balance_effect := old.balance_effect;

  -- Voiding: needs a reason, is stamped by the server, and cannot be undone from the app.
  if old.status = 'Voided' then
    new.status := 'Voided';
    new.voided_at := old.voided_at;
    new.voided_by := old.voided_by;
    new.void_reason := old.void_reason;
  elsif new.status = 'Voided' then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'A reason is required to void a payment.';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  else
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
  end if;
  return new;
end $$;

-- ===== Charges: allow voiding (reason required), nothing else editable =====
alter table public.property_charges
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

create or replace function public.protect_property_charge_fields()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if auth.uid() is null then return new; end if;
  new.id := old.id;
  new.property_id := old.property_id;
  new.charge_type := old.charge_type;
  new.description := old.description;
  new.amount := old.amount;
  new.billing_month := old.billing_month;
  new.created_by := old.created_by;
  new.created_by_name := old.created_by_name;
  new.created_at := old.created_at;

  if old.voided_at is not null then
    new.voided_at := old.voided_at;
    new.voided_by := old.voided_by;
    new.void_reason := old.void_reason;
  elsif new.voided_at is not null then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'A reason is required to void a charge.';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  else
    new.voided_by := null;
    new.void_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists protect_property_charge_fields on public.property_charges;
create trigger protect_property_charge_fields
  before update on public.property_charges
  for each row execute function public.protect_property_charge_fields();

create policy "Staff can void charges" on public.property_charges
  for update to authenticated
  using (public.current_user_role() = any (array['admin','secretary','treasurer']))
  with check (public.current_user_role() = any (array['admin','secretary','treasurer']));

grant update (voided_at, voided_by, void_reason) on public.property_charges to authenticated;

revoke execute on function public.protect_property_charge_fields() from public, anon, authenticated;
