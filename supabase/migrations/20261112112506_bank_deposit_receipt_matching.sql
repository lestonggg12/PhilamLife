-- Receipt-to-deposit matching. Additive; does not rewrite historical receipts.
-- This must follow 20261112104953_controlled_bank_deposit_workflow.sql.
BEGIN;

CREATE TABLE public.bank_deposit_receipt_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid NOT NULL REFERENCES public.bank_deposits(id) ON DELETE RESTRICT,
  payment_id bigint REFERENCES public.payments(id) ON DELETE RESTRICT,
  service_transaction_id uuid REFERENCES public.service_transactions(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid REFERENCES auth.users(id),
  removed_at timestamptz,
  remove_reason text,
  CONSTRAINT exactly_one_receipt_source CHECK (num_nonnulls(payment_id,service_transaction_id)=1),
  CONSTRAINT link_removal_evidence CHECK (
    (active AND removed_by IS NULL AND removed_at IS NULL AND remove_reason IS NULL)
    OR (NOT active AND removed_by IS NOT NULL AND removed_at IS NOT NULL AND
        remove_reason IS NOT NULL AND length(btrim(remove_reason)) BETWEEN 5 AND 500)
  )
);
CREATE UNIQUE INDEX bank_deposit_payment_once_per_deposit
  ON public.bank_deposit_receipt_links(deposit_id,payment_id)
  WHERE active AND payment_id IS NOT NULL;
CREATE UNIQUE INDEX bank_deposit_service_once_per_deposit
  ON public.bank_deposit_receipt_links(deposit_id,service_transaction_id)
  WHERE active AND service_transaction_id IS NOT NULL;
CREATE INDEX bank_deposit_receipt_links_payment_active
  ON public.bank_deposit_receipt_links(payment_id) WHERE active;
CREATE INDEX bank_deposit_receipt_links_service_active
  ON public.bank_deposit_receipt_links(service_transaction_id) WHERE active;

ALTER TABLE public.bank_deposit_receipt_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_deposit_receipt_links FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.bank_deposit_receipt_links TO authenticated;
CREATE POLICY "Finance staff read deposit matching" ON public.bank_deposit_receipt_links
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin','treasurer'));

-- Source-row locks serialize concurrent allocations of the same receipt.
-- Deposit-row locks serialize changes to a deposit and its status.
CREATE OR REPLACE FUNCTION public.link_bank_deposit_receipt(
  p_deposit_id uuid, p_payment_id bigint, p_service_transaction_id uuid, p_amount numeric)
RETURNS public.bank_deposit_receipt_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_deposit public.bank_deposits%ROWTYPE;
  v_link public.bank_deposit_receipt_links%ROWTYPE;
  v_available numeric;
  v_total numeric;
  v_source_total numeric;
  v_source_status text;
  v_source_voided timestamptz;
  v_source_method text;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'treasurer' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Treasurer can link deposit receipts.';
  END IF;
  IF num_nonnulls(p_payment_id,p_service_transaction_id) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Select exactly one payment or service receipt.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 9999999999.99
     OR p_amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
     OR round(p_amount,2) IS DISTINCT FROM p_amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter a positive allocation amount with two decimal places.';
  END IF;
  SELECT * INTO v_deposit FROM public.bank_deposits WHERE id=p_deposit_id FOR UPDATE;
  IF NOT FOUND OR v_deposit.status NOT IN ('pending','cleared') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Only pending or cleared deposits can receive receipt links.';
  END IF;
  IF p_payment_id IS NOT NULL THEN
    SELECT coalesce(amount_paid,amount),status,voided_at,payment_method
      INTO v_source_total,v_source_status,v_source_voided,v_source_method
      FROM public.payments WHERE id=p_payment_id FOR UPDATE;
    IF NOT FOUND OR v_source_status <> 'Completed' OR v_source_voided IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Select a completed, unvoided homeowner receipt.';
    END IF;
  ELSE
    SELECT amount_paid,payment_status,voided_at,payment_method
      INTO v_source_total,v_source_status,v_source_voided,v_source_method
      FROM public.service_transactions WHERE id=p_service_transaction_id FOR UPDATE;
    IF NOT FOUND OR lower(v_source_status) NOT IN ('paid','completed') OR v_source_voided IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Select a paid, unvoided service receipt.';
    END IF;
  END IF;
  IF lower(coalesce(v_source_method,'')) <> 'cash' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Only cash collections can be matched to a cash deposit.';
  END IF;
  IF v_source_total IS NULL OR v_source_total <= 0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Receipt has no eligible paid amount.';
  END IF;
  SELECT coalesce(sum(amount),0) INTO v_total FROM public.bank_deposit_receipt_links
    WHERE active AND deposit_id=p_deposit_id;
  IF v_total+p_amount > v_deposit.amount THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Matched receipt allocations cannot exceed the deposit amount.';
  END IF;
  SELECT coalesce(sum(amount),0) INTO v_total FROM public.bank_deposit_receipt_links
    WHERE active AND ((p_payment_id IS NOT NULL AND payment_id=p_payment_id)
      OR (p_service_transaction_id IS NOT NULL AND service_transaction_id=p_service_transaction_id));
  v_available := v_source_total-v_total;
  IF p_amount > v_available THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Receipt has insufficient unallocated cash value.';
  END IF;
  INSERT INTO public.bank_deposit_receipt_links
    (deposit_id,payment_id,service_transaction_id,amount,created_by)
    VALUES(p_deposit_id,p_payment_id,p_service_transaction_id,p_amount,auth.uid())
    RETURNING * INTO v_link;
  PERFORM public.write_required_balance_audit('Deposit Receipt Linked',
    'Deposit '||p_deposit_id::text||', link '||v_link.id::text||', PHP '||p_amount::text);
  RETURN v_link;
END $fn$;

CREATE OR REPLACE FUNCTION public.unlink_bank_deposit_receipt(p_link_id uuid,p_reason text)
RETURNS public.bank_deposit_receipt_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_link public.bank_deposit_receipt_links%ROWTYPE;
  v_deposit_id uuid;
  v_status text;
  v_reason text := btrim(p_reason);
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'treasurer' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Treasurer can remove receipt matching.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Provide a removal reason (5 to 500 characters).';
  END IF;
  -- Look up the parent first, then acquire locks in the same order as linking.
  SELECT deposit_id INTO v_deposit_id FROM public.bank_deposit_receipt_links WHERE id=p_link_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Receipt link not found.'; END IF;
  SELECT status INTO v_status FROM public.bank_deposits WHERE id=v_deposit_id FOR UPDATE;
  IF v_status NOT IN ('pending','cleared') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Reconciled or voided deposit links cannot be changed.';
  END IF;
  SELECT * INTO v_link FROM public.bank_deposit_receipt_links WHERE id=p_link_id FOR UPDATE;
  IF NOT v_link.active THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Receipt link is already inactive.';
  END IF;
  UPDATE public.bank_deposit_receipt_links SET active=false, removed_by=auth.uid(),
    removed_at=now(), remove_reason=v_reason WHERE id=p_link_id RETURNING * INTO v_link;
  PERFORM public.write_required_balance_audit('Deposit Receipt Unlinked',
    'Deposit '||v_link.deposit_id::text||', link '||v_link.id::text||', PHP '||v_link.amount::text);
  RETURN v_link;
END $fn$;

-- Void must not strand active allocations on a cancelled deposit.
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
  IF EXISTS (SELECT 1 FROM public.bank_deposit_receipt_links WHERE deposit_id=p_deposit_id AND active) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Treasurer must unlink all receipts before a pending deposit can be voided.';
  END IF;
  UPDATE public.bank_deposits SET status='voided',voided_by=auth.uid(),
    voided_at=now(),void_reason=v_reason WHERE id=p_deposit_id RETURNING * INTO v_row;
  RETURN v_row;
END $fn$;

-- Leave final reconciliation disabled until receipt-matching integration tests
-- and audit evidence are approved. Linking is not the same as bank clearance.
REVOKE ALL ON FUNCTION public.link_bank_deposit_receipt(uuid,bigint,uuid,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.unlink_bank_deposit_receipt(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_bank_deposit_receipt(uuid,bigint,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_bank_deposit_receipt(uuid,text) TO authenticated;
COMMIT;
