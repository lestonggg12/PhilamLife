-- Phase 2: run ONLY after the new Add Charge form is live and tested.
-- A transaction-local origin marker is set only by trusted SECURITY DEFINER
-- billing functions. Ordinary clients cannot supply it through an INSERT.
begin;
set local lock_timeout = '5s';

create or replace function public.require_manual_charge_due_date()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
declare
  trusted_origin text := coalesce(current_setting('app.charge_origin', true), '');
begin
  if trusted_origin not in ('monthly_dues', 'annual_penalty') then
    if new.due_date is null then
      raise exception 'A final due date is required for manual charges.';
    end if;
    if new.due_date < public.hoa_manila_today() then
      raise exception 'New manual charges cannot have a past due date.';
    end if;
  elsif new.billing_month is not null and new.due_date is not null then
    raise exception 'System monthly dues use the Admin due-date settings.';
  end if;
  return new;
end;
$$;

revoke all on function public.require_manual_charge_due_date() from public, anon, authenticated;
drop trigger if exists require_manual_charge_due_date on public.property_charges;
create trigger require_manual_charge_due_date
before insert on public.property_charges
for each row execute function public.require_manual_charge_due_date();

-- Mark monthly dues only inside the trusted billing function. The replacement
-- is asserted so a future upstream function change fails this migration rather
-- than silently installing an unenforced path.
do $$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.bill_monthly_dues(date)'::regprocedure) into definition;
  if position('previous_charge_origin' in definition) > 0
     or position('insert into public.property_charges' in definition) = 0
     or position('on conflict (property_id, billing_month) do nothing;' in definition) = 0 then
    raise exception 'bill_monthly_dues has an unexpected definition; review before applying Stage 2.';
  end if;
  updated := replace(
    definition,
    '  today date := public.hoa_manila_today();',
    '  today date := public.hoa_manila_today();' || chr(10) ||
    '  previous_charge_origin text := coalesce(current_setting(''app.charge_origin'', true), '''');'
  );
  updated := replace(
    updated,
    '  insert into public.property_charges',
    '  perform set_config(''app.charge_origin'', ''monthly_dues'', true);' || chr(10) ||
    '  insert into public.property_charges'
  );
  updated := replace(
    updated,
    '  on conflict (property_id, billing_month) do nothing;',
    '  on conflict (property_id, billing_month) do nothing;' || chr(10) ||
    '  perform set_config(''app.charge_origin'', previous_charge_origin, true);'
  );
  if position('monthly_dues' in updated) = 0
     or position('previous_charge_origin' in updated) = 0 then
    raise exception 'Could not mark bill_monthly_dues with a trusted origin.';
  end if;
  execute updated;
end;
$$;

-- Mark annual penalties inside post_due_penalties for both scheduled and
-- staff-invoked execution. This does not trust actor fields on the row.
do $$
declare
  definition text;
  updated text;
begin
  select pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure) into definition;
  if position('previous_charge_origin' in definition) > 0
     or position('insert into public.property_charges(property_id,charge_type,description,amount,billing_month,created_by,created_by_name)' in definition) = 0
     or position('returning id into cid;' in definition) = 0 then
    raise exception 'post_due_penalties has an unexpected definition; review before applying Stage 2.';
  end if;
  updated := replace(
    definition,
    '  today date := public.hoa_manila_today();',
    '  today date := public.hoa_manila_today();' || chr(10) ||
    '  previous_charge_origin text := coalesce(current_setting(''app.charge_origin'', true), '''');'
  );
  updated := replace(
    updated,
    '        insert into public.property_charges(property_id,charge_type,description,amount,billing_month,created_by,created_by_name)',
    '        perform set_config(''app.charge_origin'', ''annual_penalty'', true);' || chr(10) ||
    '        insert into public.property_charges(property_id,charge_type,description,amount,billing_month,created_by,created_by_name)'
  );
  updated := replace(
    updated,
    '          returning id into cid;',
    '          returning id into cid;' || chr(10) ||
    '        perform set_config(''app.charge_origin'', previous_charge_origin, true);'
  );
  if position('annual_penalty' in updated) = 0
     or position('previous_charge_origin' in updated) = 0 then
    raise exception 'Could not mark post_due_penalties with a trusted origin.';
  end if;
  execute updated;
end;
$$;

commit;
