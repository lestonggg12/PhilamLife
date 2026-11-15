-- Preserve financial rows and existing billing/cron logic. Capture the genuine
-- pre-billing balance as part of the automatic billing transaction if the
-- midnight snapshot task was missed. Never backfill November's missing detail.
CREATE OR REPLACE FUNCTION system_notification_private.capture(p_clock timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d date := (p_clock at time zone 'Asia/Manila')::date; s public.system_settings%rowtype;
begin
  select * into strict s from public.system_settings where id=1;
  if d<>system_notification_private.collection_date(d,s.billing_day) then return; end if;
  -- Allow a delayed capture only while there are no dues charges for the
  -- month. Once a charge exists, balances cannot be called pre-billing.
  if (p_clock at time zone 'Asia/Manila')::time >= time '00:05'
    and exists (
      select 1 from public.property_charges c
      where c.charge_type='Association Dues'
        and c.billing_month=date_trunc('month',d)::date
    ) then return; end if;
  insert into system_notification_private.collection_snapshots(collection_date,captured_at,accounts)
  select d,p_clock,coalesce(jsonb_agg(jsonb_build_object(
    'property_id',p.id,'balance',p.current_balance,'name',p.homeowner_name,
    'block',p.block,'lot_number',p.lot_number,'classification',p.property_classification,
    'expected_dues',public.compute_monthly_dues(p.lot_size_sqm,s.price_per_sqm),
    'already_billed',exists(select 1 from public.property_charges c where c.property_id=p.id
      and c.billing_month=date_trunc('month',d)::date and c.charge_type='Association Dues')
  ) order by p.id),'[]'::jsonb)
  from public.properties p where p.homeowner_status='active'
  on conflict(collection_date) do nothing;
end $function$;

CREATE OR REPLACE FUNCTION public.bill_monthly_dues(p_month date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := public.hoa_manila_today();
  month_start date := date_trunc('month', coalesce(p_month, today))::date;
  rate numeric;
  billing_day integer;
  bill_date date;
  n integer;
begin
  select s.billing_day into billing_day from public.system_settings s where s.id = 1 for share;
  rate := public.association_dues_rate_for_month(month_start);
  bill_date := month_start + (least(coalesce(billing_day, 1),
    extract(day from (month_start + interval '1 month - 1 day'))::int) - 1);
  if month_start > date_trunc('month', today)::date or (p_month is null and today < bill_date) then
    return 0;
  end if;

  -- Match payment locking before reading coverage for the billing insert.
  perform p.id from public.properties p
  where p.homeowner_status = 'active'
    and (p_month is not null or (p.created_at at time zone 'Asia/Manila')::date <= bill_date)
    and not exists (
      select 1 from public.property_charges c where c.property_id = p.id
        and c.billing_month = month_start and c.charge_type = 'Association Dues'
    )
  order by p.id for update;

  -- Fallback if the 00:00 snapshot job missed the billing-day window.
  -- Done under existing property locks, before posting any new dues.
  -- Explicit/backdated monthly runs must not create retrospective snapshots.
  if p_month is null then
    perform system_notification_private.capture(clock_timestamp());
  end if;

  with prepaid as materialized (
    select distinct on (property_id) property_id, payment_id, monthly_amount
    from public.active_annual_dues_coverage
    where month_start >= starts_on and month_start < ends_before
    order by property_id, starts_on, payment_id
  )
  insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by_name)
  select p.id, 'Association Dues', to_char(month_start, 'FMMonth YYYY') ||
         case when a.payment_id is not null then ' monthly dues (12-month prepaid price)'
              else ' monthly dues (' || to_char(p.lot_size_sqm, 'FM99999990.00') ||
                   ' sqm × ₱' || to_char(rate, 'FM9999999990.00') || '/sqm)' end,
         coalesce(a.monthly_amount, public.compute_monthly_dues(p.lot_size_sqm, rate)),
         month_start, 'System (automatic)'
  from public.properties p
  left join prepaid a on a.property_id = p.id
  where p.homeowner_status = 'active'
    and (p_month is not null or (p.created_at at time zone 'Asia/Manila')::date <= bill_date)
    and coalesce(a.monthly_amount, public.compute_monthly_dues(p.lot_size_sqm, rate)) > 0
  on conflict (property_id, billing_month, charge_type) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$function$;
