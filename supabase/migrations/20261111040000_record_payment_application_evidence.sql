-- Record evidence of how NEW payments affect existing account items, without
-- rewriting any legacy receipt, allocating historical cash by guesswork, or
-- changing a property balance.  This is not a replacement for explicit,
-- staff-approved payment-to-charge allocations.
--
-- This migration intentionally does not populate past payments.
-- Deploy only to a project whose data is confirmed disposable/mock, after
-- reviewing the payment trigger ordering and a fresh financial baseline.
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.financial_invariant_report
      WHERE abs(reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION 'Account balances do not reconcile; no allocation evidence migration applied';
  END IF;
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS payment_allocation_private;
REVOKE ALL ON SCHEMA payment_allocation_private FROM PUBLIC, anon, authenticated;

-- Immutable, deterministic calculation shared by the recording trigger and
-- isolated integration tests. The 'before' and 'after' sets come from the
-- authoritative property_balance_items view in the SAME payment transaction.
-- Monotonicity is essential: an item must never become MORE unpaid after a
-- payment. An unexpected view/priority change aborts the payment atomically.
CREATE OR REPLACE FUNCTION payment_allocation_private.calculate_application(
  p_before jsonb, p_after jsonb, p_effect numeric
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $function$
DECLARE
  v_items jsonb;
  v_applied numeric(12,2);
  v_advance numeric(12,2);
  v_negative integer;
  v_duplicates integer;
BEGIN
  IF p_effect IS NULL OR p_effect < 0 OR p_effect <> round(p_effect,2)
     OR jsonb_typeof(p_before) <> 'array' OR jsonb_typeof(p_after) <> 'array' THEN
    RAISE EXCEPTION 'Invalid payment application input';
  END IF;

  WITH b AS (
    SELECT x.kind, x.ref_id, x.unpaid
    FROM jsonb_to_recordset(p_before) AS x(kind text,ref_id uuid,unpaid numeric)
  ), a AS (
    SELECT x.kind, x.ref_id, x.unpaid
    FROM jsonb_to_recordset(p_after) AS x(kind text,ref_id uuid,unpaid numeric)
  ), changes AS (
    SELECT b.kind,b.ref_id,b.unpaid - coalesce(a.unpaid,0) AS amount
    FROM b LEFT JOIN a USING (kind,ref_id)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
             'kind',kind,'ref_id',ref_id,'amount',round(amount,2))
           ORDER BY kind,ref_id) FILTER (WHERE amount > 0.005),'[]'::jsonb),
         coalesce(sum(greatest(amount,0)),0),
         count(*) FILTER (WHERE amount < -0.005)
  INTO v_items,v_applied,v_negative FROM changes;

  WITH duplicate_groups AS (
    SELECT count(*) n FROM jsonb_to_recordset(p_before)
      AS x(kind text,ref_id uuid,unpaid numeric)
    GROUP BY kind,ref_id HAVING count(*)>1
    UNION ALL
    SELECT count(*) n FROM jsonb_to_recordset(p_after)
      AS x(kind text,ref_id uuid,unpaid numeric)
    GROUP BY kind,ref_id HAVING count(*)>1
  )
  SELECT count(*) INTO v_duplicates FROM duplicate_groups;

  -- Either an old item grew after the payment, or a new unpaid item appeared
  -- during the transaction (potential concurrent charge/priority divergence).
  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'Duplicate account items in payment snapshot';
  END IF;
  IF v_negative > 0 OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_after)
      AS x(kind text,ref_id uuid,unpaid numeric)
    WHERE x.unpaid > 0.005 AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_before)
        AS y(kind text,ref_id uuid,unpaid numeric)
      WHERE y.kind=x.kind AND y.ref_id=x.ref_id
    )
  ) THEN
    RAISE EXCEPTION 'Payment changed an account item unexpectedly; payment rolled back';
  END IF;
  IF v_applied > p_effect + 0.005 THEN
    RAISE EXCEPTION 'Inferred application exceeds payment effect; payment rolled back';
  END IF;
  v_advance := round(greatest(p_effect-v_applied,0),2);
  RETURN jsonb_build_object('items',v_items,'applied',round(v_applied,2),
                            'unapplied_effect',v_advance);
END;
$function$;
REVOKE ALL ON FUNCTION payment_allocation_private.calculate_application(jsonb,jsonb,numeric)
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.payment_application_snapshots (
  payment_id bigint PRIMARY KEY REFERENCES public.payments(id) ON DELETE RESTRICT,
  property_id bigint NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  cash_received numeric(12,2) NOT NULL CHECK (cash_received > 0),
  recorded_balance_effect numeric(12,2) NOT NULL CHECK (recorded_balance_effect >= 0),
  applied_to_existing_items numeric(12,2) NOT NULL CHECK (applied_to_existing_items >= 0),
  unapplied_account_effect numeric(12,2) NOT NULL CHECK (unapplied_account_effect >= 0),
  noncash_annual_discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (noncash_annual_discount >= 0),
  cash_not_reducing_balance numeric(12,2) NOT NULL DEFAULT 0 CHECK (cash_not_reducing_balance >= 0),
  evidence_basis text NOT NULL DEFAULT 'system_derived_at_receipt'
    CHECK (evidence_basis='system_derived_at_receipt'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_snapshot_effect_reconciles
    CHECK (applied_to_existing_items + unapplied_account_effect = recorded_balance_effect)
);
CREATE TABLE public.payment_application_item_snapshots (
  payment_id bigint NOT NULL REFERENCES public.payment_application_snapshots(payment_id) ON DELETE RESTRICT,
  item_kind text NOT NULL CHECK (item_kind IN ('dues','penalty','charge','entry','opening','adjustment')),
  item_ref uuid NOT NULL,
  applied_amount numeric(12,2) NOT NULL CHECK (applied_amount > 0),
  evidence_basis text NOT NULL DEFAULT 'system_derived_at_receipt'
    CHECK (evidence_basis='system_derived_at_receipt'),
  PRIMARY KEY(payment_id,item_kind,item_ref)
);
CREATE INDEX payment_application_snapshots_property_idx
  ON public.payment_application_snapshots(property_id,recorded_at);
ALTER TABLE public.payment_application_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_application_item_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_application_snapshots FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.payment_application_item_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_application_snapshots TO authenticated;
GRANT SELECT ON public.payment_application_item_snapshots TO authenticated;
CREATE POLICY "Finance staff read payment application evidence"
  ON public.payment_application_snapshots FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin','secretary','treasurer'));
CREATE POLICY "Finance staff read payment application line evidence"
  ON public.payment_application_item_snapshots FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin','secretary','treasurer'));

-- Runs alphabetically AFTER prepare_payment_before_insert, which determines
-- the cash amount, balance effect, receipt metadata, and balance snapshot.
-- The payment row is NOT in payment_pools yet, so the view is pre-payment.
CREATE OR REPLACE FUNCTION payment_allocation_private.capture_pre_payment_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_before jsonb;
BEGIN
  IF NEW.property_id IS NULL OR NEW.balance_effect IS NULL OR NEW.receipt_breakdown IS NULL THEN
    RAISE EXCEPTION 'Payment preparation must precede application snapshot';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',i.kind,
      'ref_id',i.ref_id,'unpaid',i.unpaid) ORDER BY i.kind,i.ref_id),'[]'::jsonb)
  INTO v_before FROM public.property_balance_items i
  WHERE i.property_id=NEW.property_id AND i.unpaid>0.005;
  NEW.receipt_breakdown := NEW.receipt_breakdown ||
    jsonb_build_object('_application_before',v_before);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION payment_allocation_private.capture_pre_payment_items()
  FROM PUBLIC,anon,authenticated;
CREATE TRIGGER z_capture_pre_payment_items
  BEFORE INSERT ON public.payments FOR EACH ROW
  EXECUTE FUNCTION payment_allocation_private.capture_pre_payment_items();

-- This AFTER INSERT trigger records what changed in the authoritative
-- item-allocation VIEW. It does not update balances, payments or cash receipts.
-- Voids remain auditable: payment.status identifies an inactive snapshot.
CREATE OR REPLACE FUNCTION payment_allocation_private.record_payment_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_after jsonb;
  v_result jsonb;
  v_before jsonb := NEW.receipt_breakdown->'_application_before';
  v_effect numeric(12,2) := greatest(coalesce(NEW.balance_effect,0)
                                           -coalesce(NEW.effect_released,0),0);
  v_cash numeric(12,2) := coalesce(NEW.amount_paid,NEW.amount);
  v_discount numeric(12,2) := 0;
  v_row record;
BEGIN
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'Payment application pre-snapshot missing; payment rolled back';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind',i.kind,
      'ref_id',i.ref_id,'unpaid',i.unpaid) ORDER BY i.kind,i.ref_id),'[]'::jsonb)
    INTO v_after FROM public.property_balance_items i
    WHERE i.property_id=NEW.property_id AND i.unpaid>0.005;
  v_result := payment_allocation_private.calculate_application(v_before,v_after,v_effect);

  -- Only an authenticated saved annual promotion may explain an effect greater
  -- than cash; the same validation is performed by prepare_payment_record.
  IF NEW.receipt_breakdown ? 'annual_advance_discount' THEN
    v_discount := (NEW.receipt_breakdown->'annual_advance_discount'->>'discount_amount')::numeric;
    IF v_discount IS NULL OR v_discount<=0 OR v_discount<>v_effect-v_cash THEN
      RAISE EXCEPTION 'Annual payment effect does not match its saved discount';
    END IF;
  ELSIF v_effect>v_cash+0.005 THEN
    RAISE EXCEPTION 'Unexplained noncash payment effect; payment rolled back';
  END IF;

  INSERT INTO public.payment_application_snapshots(
    payment_id,property_id,cash_received,recorded_balance_effect,
    applied_to_existing_items,unapplied_account_effect,noncash_annual_discount,
    cash_not_reducing_balance)
  VALUES(NEW.id,NEW.property_id,v_cash,v_effect,
    (v_result->>'applied')::numeric,(v_result->>'unapplied_effect')::numeric,
    v_discount,greatest(v_cash-v_effect,0));
  FOR v_row IN SELECT * FROM jsonb_to_recordset(v_result->'items')
      AS x(kind text,ref_id uuid,amount numeric) LOOP
    INSERT INTO public.payment_application_item_snapshots
      (payment_id,item_kind,item_ref,applied_amount)
    VALUES(NEW.id,v_row.kind,v_row.ref_id,v_row.amount);
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION payment_allocation_private.record_payment_application()
  FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zzz_record_payment_application
  AFTER INSERT ON public.payments FOR EACH ROW
  EXECUTE FUNCTION payment_allocation_private.record_payment_application();

-- Protect pre-existing explicit allocations too. Never allow an allocation
-- between two different properties, regardless of the calling role/RLS.
CREATE OR REPLACE FUNCTION payment_allocation_private.validate_same_property()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_payment_property bigint; v_charge_property bigint;
BEGIN
  SELECT property_id INTO v_payment_property FROM public.payments WHERE id=NEW.payment_id;
  SELECT property_id INTO v_charge_property FROM public.property_charges
    WHERE id=NEW.property_charge_id;
  IF v_payment_property IS NULL OR v_charge_property IS NULL OR
     v_payment_property<>v_charge_property THEN
    RAISE EXCEPTION 'Payment and charge must belong to the same property';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION payment_allocation_private.validate_same_property()
  FROM PUBLIC,anon,authenticated;
CREATE TRIGGER z_guard_payment_allocation_same_property
  BEFORE INSERT OR UPDATE ON public.property_payment_allocations FOR EACH ROW
  EXECUTE FUNCTION payment_allocation_private.validate_same_property();

-- Staff-visible read-only evidence. The name avoids claiming that an
-- inferred allocation is an explicitly instructed charge settlement.
CREATE VIEW public.payment_application_evidence
  WITH (security_invoker=true) AS
SELECT s.*,p.status,p.voided_at,p.receipt_number
FROM public.payment_application_snapshots s
JOIN public.payments p ON p.id=s.payment_id;
REVOKE ALL ON public.payment_application_evidence FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.payment_application_evidence TO authenticated;

COMMENT ON TABLE public.payment_application_snapshots IS
  'New-payment-only, immutable-at-insert system-derived allocation evidence. Old payments are not backfilled; row is not a cash receipt or authorized charge selection.';
COMMENT ON TABLE public.payment_application_item_snapshots IS
  'Pre/post unpaid item differences at issuance, not staff-confirmed explicit payment-to-charge assignments.';

DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.financial_invariant_report
      WHERE abs(reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION 'Financial invariant changed during migration; transaction rolled back';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_application_snapshots)
     OR EXISTS (SELECT 1 FROM public.payment_application_item_snapshots) THEN
    RAISE EXCEPTION 'Do not silently manufacture historical payment allocations';
  END IF;
END;
$postflight$;
