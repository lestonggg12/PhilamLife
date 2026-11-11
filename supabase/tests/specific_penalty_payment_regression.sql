-- PhilamLife targeted penalty payment integration regression.
-- ONLY after migration 20261111050000_specific_penalty_payment_allocation.
-- IMPORTANT: the entire test runs inside BEGIN ... ROLLBACK. Do not remove ROLLBACK.
-- Uses two synthetic fixture accounts already present in the mock database.

BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $tests$
DECLARE
  v_property bigint := 1846; -- Isabel Cruz, synthetic homeowner
  v_other_property bigint := 1902; -- Lourdes Bautista, synthetic homeowner
  v_schedule uuid := 'fa1de2b6-5e28-44cc-b463-f140088cb222';
  v_staff uuid := '56a36ea0-ba3c-4a10-96de-a0a66cb7ff97';
  v_specific_id bigint := -991997;
  v_general_id bigint := -991998;
  v_failed_id bigint := -991999;
  v_wrong_id bigint := -992000;
  v_replacement_id bigint := -992001;
  v_charge uuid;
  v_original_balance numeric;
  v_penalty numeric;
  v_unpaid numeric;
  v_original numeric;
  v_entry_before numeric;
  v_entry_after numeric;
  v_penalty_allocated numeric;
  v_other_allocated numeric;
  v_applied numeric;
  v_rejected boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments WHERE id IN
     (v_specific_id,v_general_id,v_failed_id,v_wrong_id,v_replacement_id)) THEN
    RAISE EXCEPTION 'Test payment IDs are already in use; aborting.';
  END IF;
  SELECT current_balance INTO STRICT v_original_balance
    FROM public.properties WHERE id=v_property;
  IF v_original_balance <> 1073.03 THEN
    RAISE EXCEPTION 'Mock account has changed since test preparation. Review fixtures.';
  END IF;

  -- Fast-forward one schedule only inside this rollback transaction.
  UPDATE public.annual_penalty_schedules
     SET as_of_date=DATE '2025-11-11'
   WHERE id=v_schedule AND property_id=v_property AND next_anniversary_no=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mock schedule is no longer eligible.'; END IF;
  IF public.post_due_penalties(v_property)<>1
     OR public.post_due_penalties(v_property)<>0 THEN
    RAISE EXCEPTION 'Penalty posting or duplicate prevention failed.';
  END IF;
  SELECT charge_id,penalty_amount INTO STRICT v_charge,v_penalty
    FROM public.annual_penalty_assessments WHERE schedule_id=v_schedule;
  IF v_penalty <> 32.94 THEN RAISE EXCEPTION 'Expected PHP 32.94 penalty, got %.',v_penalty; END IF;
  SELECT COALESCE(sum(unpaid),0) INTO v_entry_before
    FROM public.property_balance_items WHERE property_id=v_property AND kind='entry';

  -- An explicit penalty selection MUST settle that exact charge, not older dues.
  INSERT INTO public.payments
    (id,property_id,amount,amount_paid,payment_date,paid_at,status,
     recorded_by,receipt_number,charge_type,coverage_period,payment_method,
     note,specific_charge_id)
  VALUES
    (v_specific_id,v_property,20,20,public.hoa_manila_today(),now(),'Completed',
     v_staff,'ROLLBACK-TARGET-991997','Penalty / Late Fee','Targeted penalty smoke',
     'Cash','ROLLBACK-ONLY TEST',v_charge);

  SELECT unpaid,original INTO STRICT v_unpaid,v_original
    FROM public.property_balance_items
   WHERE property_id=v_property AND kind='penalty' AND ref_id=v_charge;
  SELECT applied_to_existing_items INTO STRICT v_applied
    FROM public.payment_application_snapshots WHERE payment_id=v_specific_id;
  SELECT COALESCE(sum(applied_amount) FILTER (WHERE item_kind='penalty'),0),
         COALESCE(sum(applied_amount) FILTER (WHERE item_kind<>'penalty'),0)
    INTO v_penalty_allocated,v_other_allocated
    FROM public.payment_application_item_snapshots WHERE payment_id=v_specific_id;
  SELECT COALESCE(sum(unpaid),0) INTO v_entry_after
    FROM public.property_balance_items WHERE property_id=v_property AND kind='entry';
  IF v_original<>32.94 OR v_unpaid<>12.94
    OR v_applied<>20 OR v_penalty_allocated<>20 OR v_other_allocated<>0
    OR v_entry_after<>v_entry_before
    OR (SELECT current_balance FROM public.properties WHERE id=v_property)<>v_original_balance+12.94 THEN
    RAISE EXCEPTION 'Specific penalty settlement or receipt evidence failed.';
  END IF;

  -- General balance payments still use the pre-existing automatic waterfall.
  INSERT INTO public.payments
    (id,property_id,amount,amount_paid,payment_date,paid_at,status,
     recorded_by,receipt_number,charge_type,coverage_period,payment_method,note)
  VALUES
    (v_general_id,v_property,10,10,public.hoa_manila_today(),now(),'Completed',
     v_staff,'ROLLBACK-GENERAL-991998','Balance Payment','General payment smoke',
     'Cash','ROLLBACK-ONLY TEST');
  SELECT COALESCE(sum(unpaid),0) INTO v_entry_after
    FROM public.property_balance_items WHERE property_id=v_property AND kind='entry';
  IF v_entry_after<>v_entry_before-10 OR
     (SELECT unpaid FROM public.property_balance_items
       WHERE property_id=v_property AND kind='penalty' AND ref_id=v_charge)<>12.94 THEN
    RAISE EXCEPTION 'General payment no longer follows its original debt waterfall.';
  END IF;

  -- Attempting to overpay a selected charge must fail transactionally.
  v_rejected:=false;
  BEGIN
    INSERT INTO public.payments
      (id,property_id,amount,amount_paid,payment_date,paid_at,status,
       recorded_by,receipt_number,charge_type,coverage_period,payment_method,specific_charge_id)
    VALUES(v_failed_id,v_property,20,20,public.hoa_manila_today(),now(),'Completed',
      v_staff,'ROLLBACK-OVERPAY-991999','Penalty / Late Fee','Overpayment rejection',
      'Cash',v_charge);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected OR EXISTS (SELECT 1 FROM public.payments WHERE id=v_failed_id) THEN
    RAISE EXCEPTION 'Overpayment was not rejected without saving.';
  END IF;

  -- Never let one property pay a penalty belonging to another property.
  v_rejected:=false;
  BEGIN
    INSERT INTO public.payments
      (id,property_id,amount,amount_paid,payment_date,paid_at,status,
       recorded_by,receipt_number,charge_type,coverage_period,payment_method,specific_charge_id)
    VALUES(v_wrong_id,v_other_property,1,1,public.hoa_manila_today(),now(),'Completed',
      v_staff,'ROLLBACK-CROSSPROP-992000','Penalty / Late Fee','Cross-property rejection',
      'Cash',v_charge);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected:=true;
  END;
  IF NOT v_rejected OR EXISTS (SELECT 1 FROM public.payments WHERE id=v_wrong_id) THEN
    RAISE EXCEPTION 'Cross-property target was not rejected without saving.';
  END IF;

  -- An actively settled charge cannot be voided while its payment is active.
  v_rejected:=false;
  BEGIN
    UPDATE public.property_charges SET voided_at=now(),voided_by=v_staff,
      void_reason='Expected rejection from test harness' WHERE id=v_charge;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Void the active payments assigned%' THEN v_rejected:=true;
    ELSE RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'An actively targeted charge was voided.'; END IF;

  UPDATE public.payments SET status='Voided',voided_at=now(),voided_by=v_staff,
    void_reason='Rollback integration void' WHERE id=v_specific_id;
  IF (SELECT unpaid FROM public.property_balance_items
       WHERE property_id=v_property AND kind='penalty' AND ref_id=v_charge)<>32.94
    OR NOT EXISTS (SELECT 1 FROM public.payment_application_snapshots
       WHERE payment_id=v_specific_id)
    OR (SELECT status FROM public.payments WHERE id=v_specific_id)<>'Voided' THEN
    RAISE EXCEPTION 'Voiding the targeted payment failed to restore the penalty/audit.';
  END IF;

  v_rejected:=false;
  BEGIN
    UPDATE public.payments SET status='Completed',voided_at=NULL,
      voided_by=NULL,void_reason=NULL WHERE id=v_specific_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'A voided specific-charge payment must be re-recorded%' THEN
      v_rejected:=true;
    ELSE RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'A targeted void was restored without review.'; END IF;

  -- A new payment may settle the full penalty after the prior receipt was voided.
  -- The voided allocation remains in audit history but consumes NO active capacity.
  INSERT INTO public.payments
    (id,property_id,amount,amount_paid,payment_date,paid_at,status,
     recorded_by,receipt_number,charge_type,coverage_period,payment_method,
     note,specific_charge_id)
  VALUES
    (v_replacement_id,v_property,32.94,32.94,public.hoa_manila_today(),now(),
     'Completed',v_staff,'ROLLBACK-REPLACEMENT-992001','Penalty / Late Fee',
     'Replacement targeted penalty','Cash','ROLLBACK-ONLY TEST',v_charge);
  IF (SELECT unpaid FROM public.property_balance_items
       WHERE property_id=v_property AND kind='penalty' AND ref_id=v_charge)<>0
    OR (SELECT applied_to_existing_items FROM public.payment_application_snapshots
       WHERE payment_id=v_replacement_id)<>32.94
    OR (SELECT count(*) FROM public.property_payment_allocations
       WHERE property_charge_id=v_charge)<>2 THEN
    RAISE EXCEPTION 'Replacement payment after a void did not settle the charge.';
  END IF;
  UPDATE public.payments SET status='Voided',voided_at=now(),voided_by=v_staff,
    void_reason='Rollback replacement payment void' WHERE id=v_replacement_id;
  IF (SELECT unpaid FROM public.property_balance_items
       WHERE property_id=v_property AND kind='penalty' AND ref_id=v_charge)<>32.94 THEN
    RAISE EXCEPTION 'Voiding the replacement payment did not restore the penalty.';
  END IF;

  UPDATE public.payments SET status='Voided',voided_at=now(),voided_by=v_staff,
    void_reason='Rollback general payment void' WHERE id=v_general_id;
  IF (SELECT current_balance FROM public.properties WHERE id=v_property)
       <>v_original_balance+v_penalty OR EXISTS (
     SELECT 1 FROM public.financial_invariant_report
      WHERE property_id=v_property AND abs(reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION 'Final rollback scenario does not reconcile.';
  END IF;
  RAISE NOTICE 'ALL targeted-penalty tests passed; transaction will now ROLLBACK.';
END $tests$;
ROLLBACK;
