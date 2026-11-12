-- Already installed in the connected mock-data Supabase project as 20261112121609.
-- Do not execute again on that project. The frontend Reconcile button remains
-- disabled until browser role tests and workflow review are completed.
CREATE OR REPLACE FUNCTION public.reconcile_bank_deposit(p_deposit_id uuid, p_note text)
RETURNS public.bank_deposits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_deposit public.bank_deposits%ROWTYPE;
  v_link public.bank_deposit_receipt_links%ROWTYPE;
  v_note text := btrim(p_note);
  v_count integer;
  v_total numeric;
  v_paid numeric;
  v_status text;
  v_voided timestamptz;
  v_method text;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'treasurer' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Treasurer can finalize reconciliation.';
  END IF;
  IF v_note IS NULL OR length(v_note) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Provide a reconciliation note (5 to 500 characters).';
  END IF;
  SELECT * INTO v_deposit FROM public.bank_deposits
  WHERE id=p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_deposit.status <> 'cleared'
     OR v_deposit.cleared_at IS NULL OR v_deposit.verified_by IS NULL
     OR v_deposit.verification_reference IS NULL
     OR length(btrim(v_deposit.verification_reference)) < 5 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Admin bank-statement clearance is required before reconciliation.';
  END IF;
  SELECT count(*),coalesce(sum(amount),0) INTO v_count,v_total
  FROM public.bank_deposit_receipt_links
  WHERE deposit_id=p_deposit_id AND active;
  IF v_count=0 OR v_total IS DISTINCT FROM v_deposit.amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Active receipt matches must exactly equal the cleared deposit amount.';
  END IF;
  FOR v_link IN
    SELECT * FROM public.bank_deposit_receipt_links
    WHERE deposit_id=p_deposit_id AND active
    ORDER BY id
  LOOP
    IF v_link.payment_id IS NOT NULL THEN
      SELECT coalesce(amount_paid,amount),status,voided_at,payment_method
        INTO v_paid,v_status,v_voided,v_method
      FROM public.payments WHERE id=v_link.payment_id FOR UPDATE;
      IF NOT FOUND OR v_status <> 'Completed' OR v_voided IS NOT NULL
         OR lower(coalesce(v_method,'')) <> 'cash'
         OR v_paid IS NULL OR v_paid <= 0 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A matched homeowner receipt is no longer eligible.';
      END IF;
    ELSIF v_link.service_transaction_id IS NOT NULL THEN
      SELECT amount_paid,payment_status,voided_at,payment_method
        INTO v_paid,v_status,v_voided,v_method
      FROM public.service_transactions WHERE id=v_link.service_transaction_id FOR UPDATE;
      IF NOT FOUND OR lower(coalesce(v_status,'')) NOT IN ('paid','completed')
         OR v_voided IS NOT NULL OR lower(coalesce(v_method,'')) <> 'cash'
         OR v_paid IS NULL OR v_paid <= 0 THEN
        RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A matched service receipt is no longer eligible.';
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A linked receipt is missing its source.';
    END IF;
    IF v_link.amount > v_paid THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='A matched amount exceeds its receipt paid amount.';
    END IF;
  END LOOP;
  UPDATE public.bank_deposits
    SET status='reconciled',reconciled_by=auth.uid(),reconciled_at=now(),reconciliation_note=v_note
    WHERE id=p_deposit_id RETURNING * INTO v_deposit;
  RETURN v_deposit;
END $fn$;
