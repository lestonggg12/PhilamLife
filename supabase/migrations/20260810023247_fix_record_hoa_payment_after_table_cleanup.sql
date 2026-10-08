create or replace function public.record_hoa_payment(
  p_property_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text default null,
  p_note text default null,
  p_payment_purpose text default 'Association Dues',
  p_coverage_period text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  actor_role text;
  property_row public.properties%rowtype;
  payment_row public.payments%rowtype;
  previous_balance numeric(12, 2);
  dues_amount numeric(12, 2);
begin
  actor_role := public.hoa_require_finance_staff();

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  if length(trim(coalesce(p_payment_method, ''))) = 0 then
    raise exception 'Payment method is required.';
  end if;

  if lower(trim(p_payment_method)) <> 'cash'
    and length(trim(coalesce(p_reference_number, ''))) = 0
  then
    raise exception 'A reference number is required for non-cash payments.';
  end if;

  select * into property_row
  from public.properties
  where id = p_property_id
  for update;

  if property_row.id is null then
    raise exception 'Property not found.';
  end if;

  select remaining_balance into previous_balance
  from public.payments
  where property_id = p_property_id
    and status <> 'Voided'
  order by paid_at desc nulls last, id desc
  limit 1;

  if previous_balance is null then
    select dues_amount into dues_amount from public.system_settings where id = 1;
    previous_balance := coalesce(dues_amount, 0);
  end if;

  insert into public.payments (
    property_id,
    homeowner_name,
    block_name,
    lot_number,
    coverage_period,
    previous_balance,
    remaining_balance,
    amount,
    amount_paid,
    payment_method,
    reference_number,
    note,
    recorded_by,
    recorded_by_name
  )
  values (
    property_row.id,
    property_row.homeowner_name,
    property_row.block,
    property_row.lot_number::text,
    trim(concat_ws(
      ' — ',
      nullif(trim(p_payment_purpose), ''),
      nullif(trim(p_coverage_period), '')
    )),
    previous_balance,
    greatest(previous_balance - p_amount, 0),
    p_amount,
    p_amount,
    p_payment_method,
    nullif(trim(p_reference_number), ''),
    nullif(trim(p_note), ''),
    auth.uid(),
    coalesce(
      (select full_name from public.profiles where id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'Staff member'
    )
  )
  returning * into payment_row;

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Payment Recorded',
    payment_row.receipt_number || ' — ' || property_row.homeowner_name ||
      ' — PHP ' || to_char(p_amount, 'FM999999999990.00')
  );

  return to_jsonb(payment_row);
end;
$function$;
