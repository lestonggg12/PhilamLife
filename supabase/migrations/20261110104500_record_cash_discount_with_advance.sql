-- A cash payment is always the amount physically received. A manual discount
-- reduces only eligible outstanding debt; excess retained money remains credit.
-- This new RPC keeps older discount/return-change RPC contracts unchanged.
create or replace function public.record_cash_payment_with_debt_discount(
  p_property_id bigint,
  p_cash_tendered numeric,
  p_discount_amount numeric,
  p_change_amount numeric,
  p_charge_type text,
  p_coverage_period text,
  p_payment_method text,
  p_reference_number text,
  p_note text,
  p_submission_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_property public.properties%rowtype;
  v_existing public.payments%rowtype;
  v_saved public.payments%rowtype;
  v_cash numeric(12,2);
  v_due numeric(12,2);
  v_eligible numeric(12,2);
  v_expected_change numeric(12,2);
  v_advance numeric(12,2);
  v_eligible_gross numeric(12,2);
  v_gross numeric(12,2);
  v_adj uuid;
  v_details jsonb;
begin
  if v_actor is null or public.current_user_role() not in ('admin','secretary','treasurer') then
    raise exception using errcode='42501', message='Only active payment staff can record manual discounts.';
  end if;
  if p_property_id is null or p_submission_key is null or
     p_charge_type not in ('Association Dues','Balance Payment','Special Assessment',
       'Penalty / Late Fee','Sticker / ID Fee','Document / Certification Fee') or
     p_cash_tendered is null or p_discount_amount is null or p_change_amount is null or
     p_cash_tendered <= 0 or p_cash_tendered > 999999999 or
     p_discount_amount <= 0 or p_change_amount < 0 or
     p_cash_tendered <> round(p_cash_tendered, 2) or
     p_discount_amount <> round(p_discount_amount, 2) or
     p_change_amount <> round(p_change_amount, 2) or
     p_change_amount >= p_cash_tendered or
     length(btrim(coalesce(p_coverage_period,''))) not between 3 and 250 or
     length(btrim(coalesce(p_payment_method,''))) = 0 then
    raise exception using errcode='22023', message='Invalid cash payment, discount or payment details.';
  end if;
  if p_payment_method <> 'Cash' and
      (p_change_amount > 0 or length(btrim(coalesce(p_reference_number,''))) = 0) then
    raise exception using errcode='22023', message='Non-cash payments require a reference and cannot return cash change.';
  end if;
  v_cash := p_cash_tendered - p_change_amount;
  v_gross := v_cash + p_discount_amount;

  -- Idempotent retry must be checked before looking at the new balance,
  -- which may already have been reduced by a successful first request.
  select * into v_existing from public.payments
   where submission_key=p_submission_key for update;
  if found then
    if v_existing.status='Voided' or v_existing.property_id<>p_property_id or
       v_existing.amount_paid<>v_cash or v_existing.charge_type<>p_charge_type or
       v_existing.coverage_period<>btrim(p_coverage_period) or
       v_existing.payment_method<>p_payment_method or
       coalesce(v_existing.reference_number,'')<>btrim(coalesce(p_reference_number,'')) or
       coalesce(v_existing.note,'')<>btrim(coalesce(p_note,'')) or
       coalesce((v_existing.receipt_breakdown->'manual_cash_discount'->>'cash_tendered')::numeric,-1)<>p_cash_tendered or
       coalesce((v_existing.receipt_breakdown->'manual_cash_discount'->>'change_returned')::numeric,-1)<>p_change_amount or
       not exists (
         select 1 from public.manual_payment_discounts d
         where d.payment_id=v_existing.id and d.charge_id is null
           and d.gross_amount=v_gross and d.discount_amount=p_discount_amount
           and d.cash_received=v_cash
       ) then
      raise exception using errcode='23505', message='This payment session has different saved details. Review history before submitting.';
    end if;
    return jsonb_build_object('payment',to_jsonb(v_existing),'already_recorded',true);
  end if;

  select * into v_property from public.properties where id=p_property_id for update;
  if not found or v_property.homeowner_status<>'active' then
    raise exception using errcode='22023', message='Select an active property before recording a payment.';
  end if;
  perform public.post_due_penalties(p_property_id);
  if exists (
    select 1 from public.financial_invariant_report f
    where f.property_id=p_property_id and abs(f.reconciliation_difference)>0.005
  ) then
    raise exception 'Property balance is unreconciled. No payment posted.';
  end if;
  select current_balance into v_due from public.properties where id=p_property_id for update;
  v_eligible := v_due;
  if p_charge_type <> 'Balance Payment' then
    select least(v_due, coalesce(sum(i.unpaid),0)) into v_eligible
    from public.property_balance_items i
    where i.property_id=p_property_id and (
      (p_charge_type='Association Dues' and
       (i.kind='opening' or (i.category='Association Dues' and i.kind in ('entry','dues'))))
      or (i.category=p_charge_type and i.kind in ('charge','dues','penalty'))
    );
  end if;
  if v_due<=0 or v_eligible<=0 then
    raise exception using errcode='22023', message='There is no outstanding debt eligible for this discount.';
  end if;
  if p_discount_amount >= v_eligible then
    raise exception using errcode='22023', message='The discount must be smaller than the eligible outstanding debt.';
  end if;
  -- Discounts are bounded by the unpaid debt, independently of cash received.
  -- For change, return exactly the overpayment after the debt discount.
  v_expected_change := greatest(p_cash_tendered - (v_due-p_discount_amount), 0);
  if p_change_amount>0 and (p_payment_method<>'Cash' or
       p_change_amount<>v_expected_change) then
    raise exception using errcode='22023', message='The amount of change no longer matches the outstanding balance.';
  end if;
  v_eligible_gross := least(v_gross, v_eligible);
  if p_discount_amount >= v_eligible_gross then
    raise exception using errcode='22023', message='The discount exceeds the eligible debt payment.';
  end if;
  v_advance := greatest(v_cash+p_discount_amount-v_due,0);
  v_details := jsonb_build_object('manual_cash_discount',jsonb_build_object(
    'cash_tendered',p_cash_tendered,
    'change_returned',p_change_amount,
    'eligible_debt_before_discount',v_eligible_gross,
    'discount_amount',p_discount_amount,
    'cash_received',v_cash,
    'advance_credit',v_advance
  ));
  if p_change_amount>0 then
    v_details := v_details || jsonb_build_object('returned_change',jsonb_build_object(
      'cash_tendered',p_cash_tendered,
      'change_amount',p_change_amount,
      'gross_before_discount',v_due,
      'discount_amount',p_discount_amount
    ));
  end if;
  insert into public.payments(property_id,amount,amount_paid,charge_type,
    coverage_period,payment_date,recorded_by,payment_method,reference_number,note,submission_key)
  values(p_property_id,v_cash,v_cash,p_charge_type,btrim(p_coverage_period),
    public.hoa_manila_today(),v_actor,p_payment_method,
    nullif(btrim(coalesce(p_reference_number,'')),''),
    nullif(btrim(coalesce(p_note,'')),''),p_submission_key)
  returning * into v_saved;

  v_adj := pg_catalog.gen_random_uuid();
  insert into public.account_adjustments(id,property_id,charge_id,adjustment_type,
    balance_effect,reason,approval_reference,created_by)
  values(v_adj,p_property_id,null,'waiver',-p_discount_amount,
    'Staff-entered discount on '||p_charge_type||' payment '||v_saved.receipt_number,
    'PAYDISC:'||v_saved.id::text,v_actor);
  -- Keep the existing journal invariant: gross_amount=cash_received+discount.
  -- Eligible discounted debt is separately journaled in receipt_breakdown,
  -- so retained advance credit does not become discount-eligible debt.
  insert into public.manual_payment_discounts(
    payment_id,property_id,charge_id,adjustment_id,charge_unpaid_before,
    discount_type,discount_input,discount_amount,cash_received,reason,
    approval_reference,created_by,gross_amount)
  values(v_saved.id,p_property_id,null,v_adj,null,
    'fixed',p_discount_amount,p_discount_amount,v_cash,
    'Staff-entered discount on '||p_charge_type,
    'PAYDISC:'||v_saved.id::text,v_actor,v_gross);
  update public.payments
    set receipt_breakdown=coalesce(receipt_breakdown,'{}'::jsonb)||v_details
    where id=v_saved.id returning * into v_saved;
  perform public.write_audit_log('Manual Payment Discount',
    format('Payment %s / property %s / gross PHP %s / cash PHP %s / discount PHP %s / staff %s',
      v_saved.receipt_number,p_property_id,v_gross,v_cash,p_discount_amount,v_actor));
  if exists (
    select 1 from public.financial_invariant_report f
    where f.property_id=p_property_id and abs(f.reconciliation_difference)>0.005
  ) then
    raise exception 'Payment discount reconciliation failed; rolled back.';
  end if;
  return jsonb_build_object('payment',to_jsonb(v_saved),'discount_amount',p_discount_amount,
    'already_recorded',false);
end
$function$;

revoke all on function public.record_cash_payment_with_debt_discount(
  bigint,numeric,numeric,numeric,text,text,text,text,text,uuid
) from public, anon;
grant execute on function public.record_cash_payment_with_debt_discount(
  bigint,numeric,numeric,numeric,text,text,text,text,text,uuid
) to authenticated;
