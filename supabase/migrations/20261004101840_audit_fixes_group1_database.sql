-- ===== 1. Track fee effects that no longer match an active charge =====
alter table public.payments
  add column if not exists effect_released numeric(12,2) not null default 0;

comment on column public.payments.effect_released is
  'Part of balance_effect that belonged to a fee charge that was later voided; it no longer counts against open charges of that type.';

-- ===== 2. Legacy receipts: record how much each one really reduced the dues balance =====
-- Dues-type receipts reduced the dues balance by their full amount; legacy fee receipts never matched a charge.
update public.payments
set balance_effect = case
      when coverage_period ~* '^(association dues|monthly dues|advance payment)' then amount_paid
      else 0
    end
where balance_effect is null;

-- ===== 3. Payments: ignore released effects; force new receipts to start as Completed =====
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

  -- A receipt always starts as Completed; voiding is a separate, audited step.
  if auth.uid() is not null then
    new.status := 'Completed';
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.effect_released := 0;
  end if;

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
      effect := paid;
    else
      select coalesce(sum(amount), 0) into charged
        from public.property_charges
        where property_id = new.property_id and charge_type = ct and voided_at is null;
      select coalesce(sum(balance_effect - effect_released), 0) into applied
        from public.payments
        where property_id = new.property_id and charge_type = ct and status <> 'Voided';
      effect := least(paid, greatest(charged - applied, 0));
    end if;

    new.previous_balance := bal;
    new.balance_effect := effect;
    new.remaining_balance := bal - effect;
    update public.properties set current_balance = new.remaining_balance where id = new.property_id;
  else
    new.balance_effect := 0;
    new.remaining_balance := new.previous_balance - new.amount_paid;
  end if;

  return new;
end $$;

-- ===== 4. Payments: freeze effect_released against direct edits =====
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
  if pg_trigger_depth() = 1 then new.effect_released := old.effect_released; end if;

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

-- ===== 5. Charges: voiding releases paid effects; restoring adds the charge back =====
create or replace function public.apply_charge_to_balance()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  charged numeric(12,2);
  applied numeric(12,2);
  excess numeric(12,2);
  take numeric(12,2);
  rec record;
begin
  if tg_op = 'INSERT' then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;

  elsif old.voided_at is null and new.voided_at is not null then
    update public.properties set current_balance = current_balance - new.amount where id = new.property_id;

    -- Fee payments that had paid this charge no longer match any active charge:
    -- release them so they cannot swallow the next charge of the same type.
    if new.charge_type <> 'Association Dues' then
      select coalesce(sum(amount), 0) into charged
        from public.property_charges
        where property_id = new.property_id and charge_type = new.charge_type and voided_at is null;
      select coalesce(sum(balance_effect - effect_released), 0) into applied
        from public.payments
        where property_id = new.property_id and charge_type = new.charge_type and status <> 'Voided';
      excess := greatest(applied - charged, 0);

      for rec in
        select id, (balance_effect - effect_released) as avail
        from public.payments
        where property_id = new.property_id and charge_type = new.charge_type
          and status <> 'Voided' and (balance_effect - effect_released) > 0
        order by paid_at desc, id desc
      loop
        exit when excess <= 0;
        take := least(excess, rec.avail);
        update public.payments set effect_released = effect_released + take where id = rec.id;
        excess := excess - take;
      end loop;
    end if;

  elsif old.voided_at is not null and new.voided_at is null then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;
  end if;
  return new;
end $$;

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
    if current_setting('app.restore_charge', true) = 'on' and new.voided_at is null then
      new.voided_by := null;       -- restored through restore_voided_charge()
      new.void_reason := null;
    else
      new.voided_at := old.voided_at;
      new.voided_by := old.voided_by;
      new.void_reason := old.void_reason;
    end if;
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

-- ===== 6. Restore a monthly dues charge that was voided by mistake =====
create or replace function public.restore_voided_charge(p_charge_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(public.current_user_role(), '') not in ('admin', 'secretary', 'treasurer') then
    raise exception 'You do not have permission to restore charges.';
  end if;

  perform set_config('app.restore_charge', 'on', true);

  update public.property_charges
     set voided_at = null
   where id = p_charge_id and voided_at is not null and charge_type = 'Association Dues';

  if not found then
    raise exception 'Only a voided monthly dues charge can be restored.';
  end if;
end $$;

revoke all on function public.restore_voided_charge(uuid) from public, anon;
grant execute on function public.restore_voided_charge(uuid) to authenticated;
revoke execute on function public.prepare_payment_record() from public, anon, authenticated;
revoke execute on function public.apply_charge_to_balance() from public, anon, authenticated;
revoke execute on function public.protect_payment_financial_fields() from public, anon, authenticated;
revoke execute on function public.protect_property_charge_fields() from public, anon, authenticated;
