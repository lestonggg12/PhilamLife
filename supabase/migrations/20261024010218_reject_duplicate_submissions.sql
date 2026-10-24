-- Reconstructed from the live database definitions so the repo matches the
-- remote migration history (version 20261024010218). Already applied remotely.

create or replace function public.reject_duplicate_charge_submission()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare uid uuid := auth.uid(); existing uuid;
begin
  if uid is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('dup-charge:' || coalesce(new.property_id::text, '-') || ':' || uid::text));
  select c.id into existing from public.property_charges c
  where c.created_by = uid and c.property_id is not distinct from new.property_id and c.charge_type = new.charge_type and c.amount = new.amount
    and coalesce(c.description, '') = coalesce(new.description, '') and c.billing_month is not distinct from new.billing_month
    and c.voided_at is null and c.created_at > now() - interval '15 seconds'
  limit 1;
  if existing is not null then
    raise exception using errcode = '23505', message = 'This charge was already added a moment ago. If you really need a second identical charge, wait 15 seconds and try again.';
  end if;
  return new;
end $function$;

create or replace function public.reject_duplicate_expense_submission()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare uid uuid := auth.uid(); existing uuid;
begin
  if uid is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('dup-expense:' || uid::text));
  select e.id into existing from public.expenses e
  where e.recorded_by = uid and e.expense_date is not distinct from new.expense_date and e.category is not distinct from new.category and e.amount = new.amount
    and coalesce(e.description, '') = coalesce(new.description, '') and coalesce(btrim(e.reference_number), '') = coalesce(btrim(new.reference_number), '')
    and e.status is distinct from 'Voided' and e.created_at > now() - interval '15 seconds'
  limit 1;
  if existing is not null then
    raise exception using errcode = '23505', message = 'This expense was already recorded a moment ago. If you really need a second identical expense, wait 15 seconds and try again.';
  end if;
  return new;
end $function$;

create or replace function public.reject_duplicate_payment_submission()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare uid uuid := auth.uid(); existing text;
begin
  if uid is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('dup-payment:' || coalesce(new.property_id::text, '-') || ':' || uid::text));
  select p.receipt_number into existing from public.payments p
  where p.recorded_by = uid and p.property_id is not distinct from new.property_id
    and coalesce(p.charge_type, 'Association Dues') = coalesce(new.charge_type, 'Association Dues')
    and coalesce(p.amount_paid, p.amount) = coalesce(new.amount_paid, new.amount)
    and p.payment_method is not distinct from new.payment_method
    and coalesce(btrim(p.reference_number), '') = coalesce(btrim(new.reference_number), '')
    and p.status is distinct from 'Voided' and p.created_at > now() - interval '15 seconds'
  limit 1;
  if existing is not null then
    raise exception using errcode = '23505',
      message = format('This payment was already recorded a moment ago (receipt %s). If you really need a second identical payment, wait 15 seconds and try again.', existing);
  end if;
  return new;
end $function$;

create or replace function public.reject_duplicate_service_submission()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare uid uuid := auth.uid(); existing text;
begin
  if uid is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('dup-service:' || coalesce(new.property_id::text, '-') || ':' || coalesce(new.balance_of::text, '-') || ':' || uid::text));
  select s.receipt_number into existing from public.service_transactions s
  where s.recorded_by = uid and s.property_id is not distinct from new.property_id and s.service_id is not distinct from new.service_id
    and s.balance_of is not distinct from new.balance_of and s.quantity is not distinct from new.quantity
    and (new.property_id is not null or coalesce(s.customer_name, '') = coalesce(new.customer_name, ''))
    and coalesce(s.amount_paid, 0) = coalesce(new.amount_paid, 0)
    and s.payment_method is not distinct from new.payment_method and coalesce(btrim(s.reference_number), '') = coalesce(btrim(new.reference_number), '')
    and lower(coalesce(s.payment_status, 'paid')) <> 'voided' and s.paid_at > now() - interval '15 seconds'
  limit 1;
  if existing is not null then
    raise exception using errcode = '23505',
      message = format('This service payment was already recorded a moment ago (receipt %s). If you really need a second identical payment, wait 15 seconds and try again.', existing);
  end if;
  return new;
end $function$;

drop trigger if exists a_reject_duplicate_submission on public.property_charges;
create trigger a_reject_duplicate_submission before insert on public.property_charges
  for each row execute function public.reject_duplicate_charge_submission();

drop trigger if exists a_reject_duplicate_submission on public.expenses;
create trigger a_reject_duplicate_submission before insert on public.expenses
  for each row execute function public.reject_duplicate_expense_submission();

drop trigger if exists a_reject_duplicate_submission on public.payments;
create trigger a_reject_duplicate_submission before insert on public.payments
  for each row execute function public.reject_duplicate_payment_submission();

drop trigger if exists a_reject_duplicate_submission on public.service_transactions;
create trigger a_reject_duplicate_submission before insert on public.service_transactions
  for each row execute function public.reject_duplicate_service_submission();