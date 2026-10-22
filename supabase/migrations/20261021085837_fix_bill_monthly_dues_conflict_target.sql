-- 20261006224000 widened the unique index on property_charges to (property_id, billing_month, charge_type),
-- but bill_monthly_dues still named the old two-column key, so the nightly cron run failed every night
-- ("no unique or exclusion constraint matching the ON CONFLICT specification") and no dues were billed.
create or replace function public.bill_monthly_dues(p_month date default null::date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  today date := public.hoa_manila_today();
  m date;
  amt numeric;
  bday integer;
  bill_date date;
  n integer;
begin
  m := date_trunc('month', coalesce(p_month, today))::date;
  select dues_amount, billing_day into amt, bday from public.system_settings where id = 1;
  if amt is null or amt <= 0 then return 0; end if;

  bill_date := m + (least(coalesce(bday, 1),
                          extract(day from (m + interval '1 month - 1 day'))::int) - 1);

  -- Scheduled runs only bill once the admin's billing day has arrived.
  if p_month is null and today < bill_date then return 0; end if;

  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select id, 'Association Dues', to_char(m, 'FMMonth YYYY') || ' monthly dues', amt, m, 'System (automatic)'
  from public.properties
  where homeowner_status = 'active'
    -- scheduled runs skip homeowners added after the billing day
    and (p_month is not null or (created_at at time zone 'Asia/Manila')::date <= bill_date)
  on conflict (property_id, billing_month, charge_type) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;