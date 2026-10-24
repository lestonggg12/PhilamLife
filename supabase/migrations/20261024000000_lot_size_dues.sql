alter table public.properties
  add column if not exists lot_size_sqm numeric(10,2)
  constraint properties_lot_size_sqm_positive check (lot_size_sqm > 0);

alter table public.system_settings
  add column if not exists price_per_sqm numeric(12,2)
  constraint system_settings_price_per_sqm_positive check (price_per_sqm > 0);

create or replace function public.compute_monthly_dues(p_lot_size_sqm numeric, p_price_per_sqm numeric)
returns numeric
language sql immutable parallel safe set search_path = ''
as $$
  select case
    when p_lot_size_sqm > 0 and p_price_per_sqm > 0
      then round(p_lot_size_sqm * p_price_per_sqm, 2)::numeric(12,2)
    else 0::numeric(12,2)
  end
$$;

create or replace view public.property_monthly_dues
with (security_invoker = true) as
select p.id as property_id, p.lot_size_sqm, s.price_per_sqm,
       public.compute_monthly_dues(p.lot_size_sqm, s.price_per_sqm) as monthly_dues
from public.properties p
cross join public.system_settings s
where s.id = 1;

create or replace function public.set_price_per_sqm(p_rate numeric)
returns numeric
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an Admin can change the price per square meter.' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'Price per square meter must be a number greater than 0.' using errcode = '22023';
  end if;
  if p_rate <> round(p_rate, 2) then
    raise exception 'Price per square meter can have at most 2 decimal places.' using errcode = '22023';
  end if;
  if p_rate >= 10000000000 then
    raise exception 'Price per square meter is too large.' using errcode = '22023';
  end if;
  update public.system_settings set price_per_sqm = p_rate, updated_by = auth.uid() where id = 1;
  return p_rate;
end $$;

create or replace function public.bill_monthly_dues(p_month date DEFAULT NULL::date)
returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  today date := public.hoa_manila_today();
  m date;
  amt numeric;
  rate numeric;
  bday integer;
  bill_date date;
  n integer;
begin
  m := date_trunc('month', coalesce(p_month, today))::date;
  select dues_amount, price_per_sqm, billing_day into amt, rate, bday from public.system_settings where id = 1;
  if rate is null and (amt is null or amt <= 0) then return 0; end if;

  bill_date := m + (least(coalesce(bday, 1),
                          extract(day from (m + interval '1 month - 1 day'))::int) - 1);

  if p_month is null and today < bill_date then return 0; end if;

  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select id, 'Association Dues', to_char(m, 'FMMonth YYYY') || ' monthly dues',
         case when rate is null then amt else public.compute_monthly_dues(lot_size_sqm, rate) end,
         m, 'System (automatic)'
  from public.properties
  where homeowner_status = 'active'
    and (p_month is not null or (created_at at time zone 'Asia/Manila')::date <= bill_date)
    and (rate is null or public.compute_monthly_dues(lot_size_sqm, rate) > 0)
  on conflict (property_id, billing_month, charge_type) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.set_price_per_sqm(numeric) from public, anon;
grant execute on function public.set_price_per_sqm(numeric) to authenticated;
revoke all on public.property_monthly_dues from public, anon;
grant select on public.property_monthly_dues to authenticated;