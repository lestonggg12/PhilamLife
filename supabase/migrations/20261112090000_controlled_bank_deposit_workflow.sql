-- PhilamLife: controlled bank-deposit bookkeeping foundation.
-- No historical payment, balance, or deposit data is modified.
-- Do not deploy until local role tests and client workflow have passed.

-- Previously bank_deposits.fund_id had no corresponding fund registry/FK.
CREATE TABLE public.deposit_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) BETWEEN 3 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.deposit_funds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deposit_funds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deposit_funds TO authenticated;
CREATE POLICY "Active finance staff read deposit funds"
  ON public.deposit_funds FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin', 'treasurer'));

ALTER TABLE public.bank_deposits
  ADD CONSTRAINT bank_deposits_fund_id_fkey
    FOREIGN KEY (fund_id) REFERENCES public.deposit_funds(id) ON DELETE RESTRICT,
  ADD COLUMN verified_by uuid REFERENCES auth.users(id),
  ADD COLUMN verification_reference text,
  ADD COLUMN reconciled_by uuid REFERENCES auth.users(id),
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN reconciliation_note text,
  ADD COLUMN voided_by uuid REFERENCES auth.users(id),
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN void_reason text,
  ADD CONSTRAINT bank_deposit_status_evidence_check CHECK (
    (status = 'pending' AND cleared_at IS NULL AND verified_by IS NULL
      AND verification_reference IS NULL AND reconciled_by IS NULL
      AND reconciled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL)
    OR (status = 'cleared' AND cleared_at IS NOT NULL AND verified_by IS NOT NULL
      AND length(btrim(verification_reference)) >= 5 AND reconciled_at IS NULL
      AND reconciled_by IS NULL AND voided_at IS NULL)
    OR (status = 'reconciled' AND cleared_at IS NOT NULL AND verified_by IS NOT NULL
      AND length(btrim(verification_reference)) >= 5 AND reconciled_at IS NOT NULL
      AND reconciled_by IS NOT NULL AND length(btrim(reconciliation_note)) >= 5
      AND voided_at IS NULL)
    OR (status = 'voided' AND cleared_at IS NULL AND verified_by IS NULL
      AND reconciled_at IS NULL AND reconciled_by IS NULL
      AND voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND length(btrim(void_reason)) >= 5)
  );

-- Use only checked SECURITY DEFINER operations; table remains read-only via API.
REVOKE INSERT, UPDATE, DELETE ON public.bank_deposits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_deposit_fund(p_name text)
RETURNS public.deposit_funds
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_row public.deposit_funds%ROWTYPE; v_name text := btrim(p_name);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Admin can register a deposit fund.';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Fund name must contain 3 to 100 characters.';
  END IF;
  INSERT INTO public.deposit_funds(name, created_by) VALUES(v_name, auth.uid()) RETURNING * INTO v_row;
  PERFORM public.write_required_balance_audit('Deposit Fund Created', 'Fund ' || v_row.id::text || ' (' || left(v_row.name,100) || ')');
  RETURN v_row;
END $fn$;

CREATE OR REPLACE FUNCTION public.record_bank_deposit(
  p_fund_id uuid, p_deposit_date date, p_bank_reference text, p_amount numeric)
RETURNS public.bank_deposits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_row public.bank_deposits%ROWTYPE; v_ref text := btrim(p_bank_reference);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'treasurer' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Treasurer can record a bank deposit.';
  END IF;
  IF p_fund_id IS NULL OR NOT EXISTS
     (SELECT 1 FROM public.deposit_funds WHERE id=p_fund_id AND active) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Select a registered active fund.';
  END IF;
  IF p_deposit_date IS NULL OR p_deposit_date > (now() AT TIME ZONE 'Asia/Manila')::date THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Deposit date cannot be in the future.';
  END IF;

-- Prevent ordinary deposit entry into a closed accounting period.
-- Historical corrections require a separately authorized workflow.
IF EXISTS (
  SELECT 1
  FROM public.accounting_periods ap
  WHERE lower(ap.status) IN ('closed', 'locked')
    AND p_deposit_date BETWEEN ap.starts_on AND ap.ends_on
) THEN
  RAISE EXCEPTION USING
    ERRCODE = '22023',
    MESSAGE = 'Cannot record a bank deposit in a closed accounting period.';
END IF;

  IF v_ref IS NULL OR length(v_ref) NOT BETWEEN 4 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Bank reference must have 4 to 100 characters.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 9999999999.99
     OR p_amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     OR round(p_amount,2) IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter a valid positive peso amount with two decimal places.';
  END IF;
  INSERT INTO public.bank_deposits(fund_id,deposit_date,bank_reference,amount,status,recorded_by)
  VALUES(p_fund_id,p_deposit_date,v_ref,p_amount,'pending',auth.uid()) RETURNING * INTO v_row;
  -- Existing mandatory AFTER INSERT audit trigger runs in this transaction.
  RETURN v_row;
END $fn$;

CREATE OR REPLACE FUNCTION public.clear_bank_deposit(p_deposit_id uuid,p_bank_evidence text)
RETURNS public.bank_deposits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF auth.uid() IS NULL
     OR public.current_user_role() IS DISTINCT FROM 'treasurer'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Only an active Treasurer can reconcile deposits.';
  END IF;

  -- Fail closed until deposit-to-receipt matching is implemented.
  -- A reconciliation note alone is not proof of matching.
  RAISE EXCEPTION USING
    ERRCODE = '0A000',
    MESSAGE =
      'Bank reconciliation is not yet enabled. Deposit-to-receipt matching is required.';
END;
$fn$;

DECLARE v_row public.bank_deposits%ROWTYPE; v_ref text := btrim(p_bank_evidence);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Admin can verify deposit clearance.';
  END IF;
  IF v_ref IS NULL OR length(v_ref) NOT BETWEEN 5 AND 200 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter a bank-statement evidence reference (5 to 200 characters).';
  END IF;
  SELECT * INTO v_row FROM public.bank_deposits WHERE id=p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Only a pending deposit can be cleared.';
  END IF;
  UPDATE public.bank_deposits
  SET status='cleared', cleared_at=now(), verified_by=auth.uid(), verification_reference=v_ref
  WHERE id=p_deposit_id RETURNING * INTO v_row;
  RETURN v_row;
END $fn$;

CREATE OR REPLACE FUNCTION public.reconcile_bank_deposit(p_deposit_id uuid,p_note text)
RETURNS public.bank_deposits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_row public.bank_deposits%ROWTYPE; v_note text := btrim(p_note);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'treasurer' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Treasurer can finalize deposit reconciliation.';
  END IF;
  IF v_note IS NULL OR length(v_note) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter a reconciliation note (5 to 500 characters).';
  END IF;
  SELECT * INTO v_row FROM public.bank_deposits WHERE id=p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'cleared' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Only an Admin-cleared deposit can be reconciled.';
  END IF;
  UPDATE public.bank_deposits
    SET status='reconciled',reconciled_by=auth.uid(),reconciled_at=now(),reconciliation_note=v_note
    WHERE id=p_deposit_id RETURNING * INTO v_row;
  RETURN v_row;
END $fn$;

CREATE OR REPLACE FUNCTION public.void_pending_bank_deposit(p_deposit_id uuid,p_reason text)
RETURNS public.bank_deposits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_row public.bank_deposits%ROWTYPE; v_reason text := btrim(p_reason);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Admin can void an unverified deposit.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter a void reason (5 to 500 characters).';
  END IF;
  SELECT * INTO v_row FROM public.bank_deposits WHERE id=p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'pending' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Only pending deposits may be voided here.';
  END IF;
  UPDATE public.bank_deposits
    SET status='voided',voided_by=auth.uid(),voided_at=now(),void_reason=v_reason
    WHERE id=p_deposit_id RETURNING * INTO v_row;
  RETURN v_row;
END $fn$;

REVOKE ALL ON FUNCTION public.create_deposit_fund(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_bank_deposit(uuid,date,text,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.clear_bank_deposit(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reconcile_bank_deposit(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.void_pending_bank_deposit(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_deposit_fund(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_bank_deposit(uuid,date,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_bank_deposit(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_bank_deposit(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_pending_bank_deposit(uuid,text) TO authenticated;
