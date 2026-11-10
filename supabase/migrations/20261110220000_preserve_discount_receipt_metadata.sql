-- Preserve trusted discount receipt metadata without allowing clients to rewrite
-- payment balances, receipt identities, or historical item breakdowns.
-- The payment RPC is SECURITY DEFINER owned by postgres; ordinary authenticated
-- updates do not execute as postgres and remain unable to edit receipt fields.
create or replace function public.protect_payment_financial_fields()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_discount numeric(12,2);
  v_cash numeric(12,2);
  v_extra jsonb;
  v_change numeric(12,2);
begin
  if auth.uid() is null then return new; end if;
  new.id := old.id;
  new.property_id := old.property_id;
  new.amount := old.amount;
  new.amount_paid := old.amount_paid;
  new.previous_balance := old.previous_balance;
  new.remaining_balance := old.remaining_balance;
  new.receipt_number := old.receipt_number;
  new.paid_at := old.paid_at;
  new.payment_date := old.payment_date;
  new.created_at := old.created_at;
  new.recorded_by := old.recorded_by;
  new.recorded_by_name := old.recorded_by_name;
  new.homeowner_name := old.homeowner_name;
  new.block_name := old.block_name;
  new.lot_number := old.lot_number;
  new.coverage_period := old.coverage_period;
  new.payment_method := old.payment_method;
  new.reference_number := old.reference_number;
  new.charge_type := old.charge_type;
  new.balance_effect := old.balance_effect;

  -- Permit only the server-owned RPC to append verified manual discount data.
  -- An authenticated PostgREST table update runs as 'authenticated', not postgres.
  v_extra := new.receipt_breakdown -> 'manual_cash_discount';
  if current_user = 'postgres' and old.status = 'Completed' and
     not (coalesce(old.receipt_breakdown,'{}'::jsonb) ? 'manual_cash_discount') and
     v_extra is not null and jsonb_typeof(v_extra) = 'object' and
     (coalesce(new.receipt_breakdown,'{}'::jsonb) - 'manual_cash_discount' - 'returned_change')
       = (coalesce(old.receipt_breakdown,'{}'::jsonb) - 'manual_cash_discount' - 'returned_change') and
     exists (select 1 from public.manual_payment_discounts d
       where d.payment_id=old.id and d.charge_id is null
         and d.cash_received=old.amount_paid
         and d.discount_amount=(v_extra->>'discount_amount')::numeric
         and d.gross_amount=old.amount_paid+d.discount_amount) then
    v_discount := (v_extra->>'discount_amount')::numeric;
    v_cash := (v_extra->>'cash_received')::numeric;
    v_change := (v_extra->>'change_returned')::numeric;
    if v_cash is distinct from old.amount_paid or v_change < 0 or
       (v_extra->>'cash_tendered')::numeric is distinct from v_cash+v_change or
       (v_extra->>'advance_credit')::numeric is distinct from
         greatest(v_cash+v_discount-old.previous_balance,0) or
       (v_extra->>'eligible_debt_before_discount')::numeric > old.previous_balance or
       (v_extra->>'eligible_debt_before_discount')::numeric <= v_discount or
       (v_change > 0 and
         (new.receipt_breakdown->'returned_change'->>'change_amount')::numeric
           is distinct from v_change) or
       (v_change = 0 and new.receipt_breakdown ? 'returned_change' and
         new.receipt_breakdown->'returned_change' is distinct from old.receipt_breakdown->'returned_change') then
      new.receipt_breakdown := old.receipt_breakdown;
    end if;
  else
    new.receipt_breakdown := old.receipt_breakdown;
  end if;
  if pg_trigger_depth() = 1 then new.effect_released := old.effect_released; end if;
  if old.status = 'Voided' then
    new.status := 'Voided';
    new.voided_at := old.voided_at;
    new.voided_by := old.voided_by;
    new.void_reason := old.void_reason;
  elsif new.status = 'Voided' then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'A reason is required to void a payment.';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  else
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
  end if;
  return new;
end
$function$;

-- Existing discount transactions remain unchanged. Legacy printed receipts can
-- reconstruct the debt/advance split from their saved balance and journal.
