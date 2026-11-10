-- Validate eligibility after acquiring the existing lot lock and posting due penalties.
begin;
do $guard$
begin
  if (select md5(prosrc) from pg_proc where oid='public.record_payment_with_optional_discount(bigint,numeric,numeric,text,text,text,text,text,uuid)'::regprocedure)
      is distinct from 'd08e00b56f2544cfd6ee37a99f0fde99' then
    raise exception 'Manual-discount RPC differs from the verified baseline. Migration canceled.';
  end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.record_payment_with_optional_discount(p_property_id bigint, p_gross_amount numeric, p_discount_amount numeric, p_charge_type text, p_coverage_period text, p_payment_method text, p_reference_number text, p_note text, p_submission_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=auth.uid();
 v_property public.properties%rowtype;
 v_existing public.payments%rowtype;
 v_payment public.payments%rowtype;
 v_cash numeric(12,2);
 v_adj uuid;
 v_unpaid numeric(12,2);
BEGIN
 IF v_actor IS NULL OR public.current_user_role() NOT IN ('admin','secretary','treasurer') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only active payment staff can record manual discounts.';
 END IF;
 IF p_submission_key IS NULL OR p_property_id IS NULL OR
    p_charge_type NOT IN ('Association Dues','Balance Payment','Special Assessment',
      'Penalty / Late Fee','Sticker / ID Fee','Document / Certification Fee') OR
    p_gross_amount IS NULL OR p_discount_amount IS NULL OR
    p_gross_amount<=0 OR p_discount_amount<=0 OR p_discount_amount>=p_gross_amount OR
    p_gross_amount<>round(p_gross_amount,2) OR p_discount_amount<>round(p_discount_amount,2) OR
    p_gross_amount>999999999 OR
    length(btrim(coalesce(p_coverage_period,''))) NOT BETWEEN 3 AND 250 OR
    length(btrim(coalesce(p_payment_method,'')))=0 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid payment amount, discount or payment details.';
 END IF;
 IF p_payment_method<>'Cash' AND length(btrim(coalesce(p_reference_number,'')))=0 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='A non-cash payment reference is required.';
 END IF;
 v_cash:=p_gross_amount-p_discount_amount;
 SELECT * INTO v_property FROM public.properties WHERE id=p_property_id FOR UPDATE;
 IF NOT FOUND OR v_property.homeowner_status<>'active' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Select an active property before recording a payment.';
 END IF;
 SELECT * INTO v_existing FROM public.payments WHERE submission_key=p_submission_key FOR UPDATE;
 IF FOUND THEN
   IF v_existing.status='Voided' OR v_existing.property_id<>p_property_id
     OR v_existing.amount_paid<>v_cash OR
     v_existing.charge_type<>p_charge_type OR
     v_existing.coverage_period<>btrim(p_coverage_period) OR
     v_existing.payment_method<>p_payment_method OR
     coalesce(v_existing.reference_number,'')<>btrim(coalesce(p_reference_number,'')) OR
     coalesce(v_existing.note,'')<>btrim(coalesce(p_note,'')) OR
     NOT EXISTS (
       SELECT 1 FROM public.manual_payment_discounts d
       WHERE d.payment_id=v_existing.id AND d.charge_id IS NULL
         AND d.gross_amount=p_gross_amount AND d.discount_amount=p_discount_amount
         AND d.discount_type='fixed' AND d.cash_received=v_cash
     )
   THEN
     RAISE EXCEPTION USING ERRCODE='23505',
       MESSAGE='This payment session has different saved details. Review history before submitting.';
   END IF;
   RETURN jsonb_build_object('payment',to_jsonb(v_existing),'already_recorded',true,
     'discount_amount',p_discount_amount);
 END IF;
 PERFORM public.post_due_penalties(p_property_id);
 IF EXISTS(SELECT 1 FROM public.financial_invariant_report f
     WHERE f.property_id=p_property_id AND abs(f.reconciliation_difference)>0.005)
 THEN RAISE EXCEPTION 'Property balance is unreconciled. No payment posted.'; END IF;
 -- Re-read the lot after penalty posting. The lot lock is still held.
 SELECT current_balance INTO v_unpaid FROM public.properties WHERE id=p_property_id;
 IF p_charge_type <> 'Balance Payment' THEN
   SELECT least(v_unpaid,coalesce(sum(i.unpaid),0)) INTO v_unpaid
   FROM public.property_balance_items i
   WHERE i.property_id=p_property_id
     AND (
       (p_charge_type='Association Dues' AND (
         i.kind='opening' OR (i.category='Association Dues' AND i.kind IN ('entry','dues'))
       ))
       OR (i.category=p_charge_type AND i.kind IN ('charge','dues','penalty'))
     );
 END IF;
 IF v_unpaid<=0 THEN
   RAISE EXCEPTION USING ERRCODE='22023',
     MESSAGE='There is no outstanding debt eligible for this discount.';
 END IF;
 IF p_gross_amount>v_unpaid THEN
   RAISE EXCEPTION USING ERRCODE='22023',
     MESSAGE='The original amount exceeds the unpaid charges for this payment purpose.';
 END IF;
 INSERT INTO public.payments(property_id,amount,amount_paid,charge_type,
   coverage_period,payment_date,recorded_by,payment_method,reference_number,note,submission_key)
 VALUES(p_property_id,v_cash,v_cash,p_charge_type,
   btrim(p_coverage_period),public.hoa_manila_today(),v_actor,
   p_payment_method,nullif(btrim(coalesce(p_reference_number,'')),''),
   nullif(btrim(coalesce(p_note,'')),''),p_submission_key)
 RETURNING * INTO v_payment;
 v_adj:=pg_catalog.gen_random_uuid();
 INSERT INTO public.account_adjustments(id,property_id,charge_id,adjustment_type,
   balance_effect,reason,approval_reference,created_by)
 VALUES(v_adj,p_property_id,NULL,'waiver',-p_discount_amount,
   'Staff-entered discount on '||p_charge_type||' payment '||v_payment.receipt_number,
   'PAYDISC:'||v_payment.id::text,v_actor);
 INSERT INTO public.manual_payment_discounts(
   payment_id,property_id,charge_id,adjustment_id,charge_unpaid_before,
   discount_type,discount_input,discount_amount,cash_received,reason,
   approval_reference,created_by,gross_amount)
 VALUES(v_payment.id,p_property_id,NULL,v_adj,NULL,
   'fixed',p_discount_amount,p_discount_amount,v_cash,
   'Staff-entered discount on '||p_charge_type,
   'PAYDISC:'||v_payment.id::text,v_actor,p_gross_amount);
 PERFORM public.write_audit_log('Manual Payment Discount',
   format('Payment %s / property %s / gross PHP %s / cash PHP %s / discount PHP %s / staff %s',
      v_payment.receipt_number,p_property_id,p_gross_amount,v_cash,p_discount_amount,v_actor));
 IF EXISTS(SELECT 1 FROM public.financial_invariant_report f
   WHERE f.property_id=p_property_id AND abs(f.reconciliation_difference)>0.005)
 THEN RAISE EXCEPTION 'Payment discount reconciliation failed; rolled back.'; END IF;
 RETURN jsonb_build_object('payment',to_jsonb(v_payment),'discount_amount',p_discount_amount,
   'already_recorded',false);
END $function$;

commit;
