-- Track the returned-change function already installed in Supabase.
-- Migration version: 20261105112251.

CREATE OR REPLACE FUNCTION public.record_payment_with_returned_change(
    p_property_id bigint,
    p_original_amount numeric,
    p_discount_amount numeric,
    p_change_amount numeric,
    p_charge_type text,
    p_coverage_period text,
    p_payment_method text,
    p_reference_number text,
    p_note text,
    p_submission_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
 v_actor uuid:=auth.uid();
 v_property public.properties%rowtype;
 v_old public.payments%rowtype;
 v_saved public.payments%rowtype;
 v_cash numeric(12,2);
 v_gross numeric(12,2);
 v_details jsonb;
 v_result jsonb;
begin
 if v_actor is null or public.current_user_role() not in ('admin','secretary','treasurer') then
  raise exception using errcode='42501',message='Payment staff authorization required';
 end if;
 if p_property_id is null or p_submission_key is null or
    p_charge_type not in ('Association Dues','Balance Payment') or
    p_original_amount is null or p_discount_amount is null or p_change_amount is null or
    p_original_amount<=0 or p_discount_amount<0 or p_change_amount<=0 or
    p_original_amount<>round(p_original_amount,2) or
    p_discount_amount<>round(p_discount_amount,2) or
    p_change_amount<>round(p_change_amount,2) or p_original_amount>999999999 or
    p_change_amount>=p_original_amount-p_discount_amount or
    length(btrim(coalesce(p_coverage_period,''))) not between 3 and 250 then
  raise exception using errcode='22023',message='Invalid cash change payment';
 end if;
 if p_payment_method <> 'Cash' then
  raise exception using errcode='22023',message='Returned change is only supported for cash payments';
 end if;
 v_gross:=p_original_amount-p_change_amount;
 v_cash:=v_gross-p_discount_amount;
 v_details:=jsonb_build_object('returned_change',jsonb_build_object(
  'cash_tendered',p_original_amount-p_discount_amount,
  'change_amount',p_change_amount,'gross_before_discount',v_gross,
  'discount_amount',p_discount_amount));
 select * into v_old from public.payments where submission_key=p_submission_key for update;
 if found then
  if v_old.status='Voided' or v_old.property_id<>p_property_id or
     v_old.amount_paid<>v_cash or v_old.charge_type<>p_charge_type or
     v_old.coverage_period<>btrim(p_coverage_period) or
     v_old.payment_method<>p_payment_method or
     coalesce(v_old.reference_number,'')<>btrim(coalesce(p_reference_number,'')) or
     coalesce(v_old.note,'')<>btrim(coalesce(p_note,'')) or
     v_old.receipt_breakdown->'returned_change'<>v_details->'returned_change' or
     (p_discount_amount>0 and not exists(
       select 1 from public.manual_payment_discounts d where d.payment_id=v_old.id
         and d.charge_id is null and d.gross_amount=v_gross
         and d.discount_amount=p_discount_amount)) or
     (p_discount_amount=0 and exists(
       select 1 from public.manual_payment_discounts d where d.payment_id=v_old.id))
   then raise exception using errcode='23505',message='Payment session does not match recorded transaction';
  end if;
  return jsonb_build_object('payment',to_jsonb(v_old),'already_recorded',true);
 end if;
 select * into v_property from public.properties where id=p_property_id for update;
 if not found or v_property.homeowner_status<>'active' then
  raise exception using errcode='22023',message='Active property required';
 end if;
 perform public.post_due_penalties(p_property_id);
 select * into v_property from public.properties where id=p_property_id for update;
 if v_property.current_balance<=0 or p_discount_amount>=v_property.current_balance or
    abs(v_gross-v_property.current_balance)>0.005 then
  raise exception using errcode='22023',message='Outstanding balance changed. Refresh before returning change';
 end if;
 if exists(select 1 from public.financial_invariant_report f where f.property_id=p_property_id and abs(f.reconciliation_difference)>0.005) then
  raise exception 'Property balance unreconciled';
 end if;
 if p_discount_amount>0 then
   v_result:=public.record_payment_with_optional_discount(
    p_property_id,v_gross,p_discount_amount,p_charge_type,p_coverage_period,
    p_payment_method,p_reference_number,p_note,p_submission_key);
   update public.payments set receipt_breakdown=coalesce(receipt_breakdown,'{}'::jsonb)||v_details
    where id=(v_result->'payment'->>'id')::bigint returning * into v_saved;
 else
   insert into public.payments(property_id,amount,amount_paid,charge_type,coverage_period,
     payment_date,recorded_by,payment_method,reference_number,note,submission_key,receipt_breakdown)
   values(p_property_id,v_cash,v_cash,p_charge_type,btrim(p_coverage_period),
     public.hoa_manila_today(),v_actor,p_payment_method,
     nullif(btrim(coalesce(p_reference_number,'')),''),
     nullif(btrim(coalesce(p_note,'')),''),p_submission_key,v_details)
   returning * into v_saved;
 end if;
 if not found or v_saved.id is null then raise exception 'Payment not verified'; end if;
 if exists(select 1 from public.financial_invariant_report f where f.property_id=p_property_id and abs(f.reconciliation_difference)>0.005) then
  raise exception 'Payment reconciliation failed';
 end if;
 perform public.write_audit_log('Returned Payment Change',
  format('Payment %s / property %s / tendered PHP %s / returned PHP %s / retained PHP %s',
   v_saved.receipt_number,p_property_id,p_original_amount-p_discount_amount,p_change_amount,v_cash));
 return jsonb_build_object('payment',to_jsonb(v_saved),'already_recorded',false);
end
$function$;

REVOKE ALL ON FUNCTION public.record_payment_with_returned_change(
    bigint,numeric,numeric,numeric,text,text,text,text,text,uuid
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_payment_with_returned_change(
    bigint,numeric,numeric,numeric,text,text,text,text,text,uuid
) TO authenticated;