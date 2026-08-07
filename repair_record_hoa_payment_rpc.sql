-- PhilamLife HOA only (project ref: fjplcgszwezfgswekvep)
-- Safe to run more than once. This repairs the payment RPC without changing
-- existing charges, payments, allocations, or homeowner records.

do $$
begin
  if to_regclass('public.properties') is null
    or to_regclass('public.payments') is null
    or to_regclass('public.homeowner_charges') is null
    or to_regclass('public.payment_allocations') is null
    or to_regclass('public.homeowner_ledger_summary') is null
  then
    raise exception
      'The HOA ledger foundation is incomplete. Apply 20260805120000_hoa_ledger_foundation.sql first.';
  end if;

  if to_regprocedure('public.hoa_require_finance_staff()') is null then
    raise exception
      'The HOA finance authorization function is missing. Apply 20260805120000_hoa_ledger_foundation.sql first.';
  end if;
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  property_row public.properties%rowtype;
  payment_row public.payments%rowtype;
  previous_balance numeric(12, 2);
  remaining_to_allocate numeric(12, 2);
  charge_row record;
  allocation_amount numeric(12, 2);
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

  select outstanding_balance into previous_balance
  from public.homeowner_ledger_summary
  where property_id = p_property_id;

  previous_balance := coalesce(previous_balance, 0);

  insert into public.payments (
    property_id,
    homeowner_name,
    block_name,
    lot_number,
    coverage_period,
    previous_balance,
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

  remaining_to_allocate := p_amount;

  for charge_row in
    select
      charge.id,
      charge.amount - coalesce(sum(allocation.amount) filter (
        where allocation.reversed_at is null
      ), 0) as open_amount
    from public.homeowner_charges charge
    left join public.payment_allocations allocation
      on allocation.charge_id = charge.id
    where charge.property_id = p_property_id
      and charge.status <> 'voided'
    group by charge.id, charge.amount, charge.due_date, charge.posted_at
    having charge.amount > coalesce(sum(allocation.amount) filter (
      where allocation.reversed_at is null
    ), 0)
    order by charge.due_date, charge.posted_at, charge.id
  loop
    exit when remaining_to_allocate <= 0;
    allocation_amount := least(remaining_to_allocate, charge_row.open_amount);

    insert into public.payment_allocations (
      payment_id,
      charge_id,
      amount,
      allocated_by
    )
    values (
      payment_row.id,
      charge_row.id,
      allocation_amount,
      auth.uid()
    );

    remaining_to_allocate := remaining_to_allocate - allocation_amount;
  end loop;

  update public.homeowner_charges charge
  set status = case
    when coalesce(allocation.allocated, 0) >= charge.amount then 'paid'
    when coalesce(allocation.allocated, 0) > 0 then 'partial'
    else 'open'
  end
  from (
    select charge_id, sum(amount) as allocated
    from public.payment_allocations
    where reversed_at is null
    group by charge_id
  ) allocation
  where charge.id = allocation.charge_id
    and charge.property_id = p_property_id
    and charge.status <> 'voided';

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Payment Recorded',
    payment_row.receipt_number || ' — ' || property_row.homeowner_name ||
      ' — PHP ' || to_char(p_amount, 'FM999999999990.00')
  );

  return to_jsonb(payment_row) || jsonb_build_object(
    'allocated_amount', p_amount - remaining_to_allocate,
    'unallocated_amount', remaining_to_allocate
  );
end;
$$;

revoke all on function public.record_hoa_payment(
  bigint, numeric, text, text, text, text, text
) from public, anon;

grant execute on function public.record_hoa_payment(
  bigint, numeric, text, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure(
    'public.record_hoa_payment(bigint,numeric,text,text,text,text,text)'
  )::text as deployed_signature;