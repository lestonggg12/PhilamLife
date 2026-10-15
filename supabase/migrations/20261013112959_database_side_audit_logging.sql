create or replace function public.audit_peso(p_amount numeric)
returns text language sql immutable set search_path to 'public'
as $$ select '₱' || to_char(coalesce(p_amount, 0), 'FM999,999,990.00') $$;

-- Writes one activity_log row for the signed-in user. Never blocks the business action if logging fails.
create or replace function public.write_audit_log(p_action text, p_target text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return; end if;
  begin
    perform set_config('app.audit_trigger', 'on', true);
    insert into public.activity_log (user_id, action, target) values (auth.uid(), p_action, p_target);
    perform set_config('app.audit_trigger', 'off', true);
  exception when others then
    perform set_config('app.audit_trigger', 'off', true);
    raise warning 'activity log write failed: %', sqlerrm;
  end;
end $$;

revoke all on function public.write_audit_log(text, text) from public, anon, authenticated;
revoke all on function public.audit_peso(numeric) from public, anon, authenticated;

create or replace function public.audit_payment_change()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('Payment Recorded',
      new.receipt_number || ' — ' || coalesce(new.homeowner_name, '') || ' — ' || public.audit_peso(coalesce(new.amount_paid, new.amount)));
  elsif old.status is distinct from 'Voided' and new.status = 'Voided' then
    perform public.write_audit_log('Payment Voided',
      new.receipt_number || ' — ' || coalesce(new.homeowner_name, '') || ' — ' || public.audit_peso(new.amount_paid) || ' — ' || coalesce(new.void_reason, ''));
  end if;
  return new;
end $$;

create trigger audit_payment_change
  after insert or update of status on public.payments
  for each row execute function public.audit_payment_change();

create or replace function public.audit_charge_change()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare owner_name text;
begin
  select homeowner_name into owner_name from public.properties where id = new.property_id;
  if tg_op = 'INSERT' then
    if new.billing_month is null then
      perform public.write_audit_log('Charge Added',
        new.charge_type || ' — ' || coalesce(owner_name, 'Homeowner') || ' — ' || public.audit_peso(new.amount));
    end if;
  elsif old.voided_at is null and new.voided_at is not null then
    perform public.write_audit_log('Charge Voided',
      new.charge_type || ' — ' || coalesce(owner_name, 'Homeowner') || ' — ' || public.audit_peso(new.amount) || ' — ' || coalesce(new.void_reason, ''));
  elsif old.voided_at is not null and new.voided_at is null then
    perform public.write_audit_log('Charge Restored',
      new.charge_type || ' — ' || coalesce(owner_name, 'Homeowner') || ' — ' || public.audit_peso(new.amount));
  end if;
  return new;
end $$;

create trigger audit_charge_change
  after insert or update of voided_at on public.property_charges
  for each row execute function public.audit_charge_change();

create or replace function public.audit_service_change()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare parent_receipt text;
begin
  if tg_op = 'INSERT' then
    if new.balance_of is null then
      perform public.write_audit_log('Service Payment Recorded',
        new.receipt_number || ' — ' || new.service_name || ' for ' || new.customer_name);
    else
      select receipt_number into parent_receipt from public.service_transactions where id = new.balance_of;
      perform public.write_audit_log('Service Balance Collected',
        new.receipt_number || ' — ' || public.audit_peso(new.amount_paid) || ' for ' || coalesce(parent_receipt, '') || ' — ' || new.customer_name);
    end if;
  elsif old.payment_status is distinct from 'voided' and new.payment_status = 'voided' then
    perform public.write_audit_log('Service Receipt Voided',
      new.receipt_number || ' — ' || new.service_name || ' for ' || new.customer_name || ' — ' || public.audit_peso(new.amount_paid) || ' — ' || coalesce(new.void_reason, ''));
  end if;
  return new;
end $$;

create trigger audit_service_change
  after insert or update of payment_status on public.service_transactions
  for each row execute function public.audit_service_change();

-- Transitional guard: the app still logs these actions from the browser. Drop the browser copy when the
-- database already logged the same event for the same user in the last 2 minutes.
create or replace function public.dedupe_client_audit()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if coalesce(current_setting('app.audit_trigger', true), 'off') = 'on' or auth.uid() is null then
    return new;
  end if;
  if new.action in ('Payment Recorded', 'Payment Voided', 'Charge Added', 'Charge Voided',
                    'Service Payment Recorded', 'Service Balance Collected') and exists (
       select 1 from public.activity_log a
        where a.user_id = new.user_id
          and a.action = new.action
          and a.created_at > now() - interval '2 minutes'
          and split_part(a.target, ' — ', 1) = split_part(new.target, ' — ', 1)
          and (new.action not like 'Charge%' or split_part(a.target, ' — ', 2) = split_part(new.target, ' — ', 2))
     ) then
    return null;
  end if;
  return new;
end $$;

create trigger dedupe_client_audit
  before insert on public.activity_log
  for each row execute function public.dedupe_client_audit();;
