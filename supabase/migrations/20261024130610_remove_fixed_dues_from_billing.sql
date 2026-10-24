create or replace function public.bill_monthly_dues(p_month date DEFAULT NULL::date)
returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  today date := public.hoa_manila_today();
  m date;
  rate numeric;
  bday integer;
  bill_date date;
  n integer;
begin
  m := date_trunc('month', coalesce(p_month, today))::date;
  select price_per_sqm, billing_day into rate, bday from public.system_settings where id = 1;
  if rate is null or rate <= 0 then return 0; end if;

  bill_date := m + (least(coalesce(bday, 1),
                          extract(day from (m + interval '1 month - 1 day'))::int) - 1);

  if p_month is null and today < bill_date then return 0; end if;

  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select id, 'Association Dues',
         to_char(m, 'FMMonth YYYY') || ' monthly dues (' || to_char(lot_size_sqm, 'FM99999990.00') || ' sqm × ₱' || to_char(rate, 'FM9999999990.00') || '/sqm)',
         public.compute_monthly_dues(lot_size_sqm, rate),
         m, 'System (automatic)'
  from public.properties
  where homeowner_status = 'active'
    and public.compute_monthly_dues(lot_size_sqm, rate) > 0
    and (p_month is not null or (created_at at time zone 'Asia/Manila')::date <= bill_date)
  on conflict (property_id, billing_month, charge_type) do nothing;

  get diagnostics n = row_count;
  return n;
end $function$;