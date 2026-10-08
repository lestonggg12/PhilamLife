alter table public.system_settings
  add column if not exists billing_day smallint not null default 1
  check (billing_day between 1 and 31);

comment on column public.system_settings.billing_day is
  'Day of the month the monthly dues are charged to every active homeowner (clamped to the last day of short months).';

create or replace function public.bill_monthly_dues(p_month date default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
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
  on conflict (property_id, billing_month) do nothing;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.bill_monthly_dues(date) from public, anon, authenticated;

-- Daily at 00:05 Manila (16:05 UTC); the function decides whether billing is due.
select cron.schedule('bill-monthly-dues', '5 16 * * *', $$select public.bill_monthly_dues()$$);
