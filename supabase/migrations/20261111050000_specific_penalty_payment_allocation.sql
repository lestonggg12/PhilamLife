-- Controlled, future-only explicit penalty settlement.
-- Historical payments and their system-derived snapshots are never rewritten.
-- All statements must run in one transaction (normal Supabase migration runner).

DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.financial_invariant_report WHERE abs(reconciliation_difference) > 0.005) THEN
    RAISE EXCEPTION 'The financial ledger does not reconcile; targeted allocation migration aborted.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_payment_allocations) THEN
    RAISE EXCEPTION 'Existing explicit allocations require a migration review before enabling targeted penalty payments.';
  END IF;
  IF to_regprocedure('payment_allocation_private.capture_pre_payment_items()') IS NULL
     OR to_regprocedure('payment_allocation_private.record_payment_application()') IS NULL THEN
    RAISE EXCEPTION 'The payment application evidence migration is required first.';
  END IF;
END $preflight$;

CREATE TEMP TABLE _specific_penalty_before ON COMMIT DROP AS
  SELECT property_id, kind, ref_id, original, unpaid FROM public.property_balance_items;

ALTER TABLE public.payments
  ADD COLUMN specific_charge_id uuid REFERENCES public.property_charges(id);
COMMENT ON COLUMN public.payments.specific_charge_id IS
  'Optional exact Penalty / Late Fee charge selected by staff; NULL means existing automatic payment waterfall.';

CREATE INDEX payments_specific_charge_id_index
  ON public.payments (specific_charge_id) WHERE specific_charge_id IS NOT NULL;

-- Preserve the existing view's public columns and its legacy math for all records.
-- Only active allocations linked to payments.specific_charge_id participate in the
-- explicit settlement computation. Unrelated allocation records are not reinterpreted.
DO $replace_ledger$
DECLARE
  v_definition text := pg_get_viewdef('public.property_balance_items'::regclass, true);
  v_find_charge text := '(c.amount - COALESCE(cctv.linked_credit, 0::numeric))::numeric(12,2) AS amount';
  v_find_pool text := 'sum(GREATEST(COALESCE(payments.balance_effect, 0::numeric) - COALESCE(payments.effect_released, 0::numeric), 0::numeric)) AS effect';
  v_find_output text := E'    original,\n    GREATEST(0::numeric, LEAST(typed_unpaid, cumulative_unpaid - general_credit))::numeric(12,2) AS unpaid';
  v_rewrite_charge text := $charge$
(c.amount - COALESCE(cctv.linked_credit, 0::numeric) - (
  SELECT COALESCE(sum(a.allocated_amount), 0)
  FROM public.property_payment_allocations a
  JOIN public.payments p ON p.id = a.payment_id
  WHERE a.property_charge_id = c.id
    AND p.status IS DISTINCT FROM 'Voided'
    AND p.specific_charge_id = c.id
))::numeric(12,2) AS amount$charge$;
  v_rewrite_pool text := $pool$
sum(GREATEST(COALESCE(payments.balance_effect, 0::numeric) - COALESCE(payments.effect_released, 0::numeric), 0::numeric) - (
  SELECT COALESCE(sum(a.allocated_amount), 0)
  FROM public.property_payment_allocations a
  WHERE a.payment_id = payments.id
    AND a.property_charge_id = payments.specific_charge_id
)) AS effect$pool$; 
  v_rewrite_output text := $output$
    (original + CASE WHEN kind IN ('dues','penalty','charge') THEN (
      SELECT COALESCE(sum(a.allocated_amount), 0)
      FROM public.property_payment_allocations a
      JOIN public.payments p ON p.id = a.payment_id
      WHERE a.property_charge_id = ref_id
        AND p.status IS DISTINCT FROM 'Voided'
        AND p.specific_charge_id = ref_id
    ) ELSE 0 END)::numeric(12,2) AS original,
    GREATEST(0::numeric, LEAST(typed_unpaid, cumulative_unpaid - general_credit))::numeric(12,2) AS unpaid$output$;
BEGIN
  -- Fail closed if the upstream view was edited or its generated SQL format changed.
  IF (length(v_definition)-length(replace(v_definition,v_find_charge,'')))/length(v_find_charge) <> 1
     OR (length(v_definition)-length(replace(v_definition,v_find_pool,'')))/length(v_find_pool) <> 1
     OR (length(v_definition)-length(replace(v_definition,v_find_output,'')))/length(v_find_output) <> 1 THEN
    RAISE EXCEPTION 'Unexpected property_balance_items view definition; review and regenerate this migration.';
  END IF;
  v_definition := replace(v_definition,v_find_charge,btrim(v_rewrite_charge));
  v_definition := replace(v_definition,v_find_pool,btrim(v_rewrite_pool));
  v_definition := replace(v_definition,v_find_output,v_rewrite_output);
  EXECUTE 'CREATE OR REPLACE VIEW public.property_balance_items AS ' || v_definition;
END $replace_ledger$;

-- Replaced payments are allowed after a void. Historical allocation rows remain
-- immutable audit evidence, but a voided receipt cannot consume charge capacity.
CREATE OR REPLACE FUNCTION public.validate_property_payment_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $body$
DECLARE
  v_payment_effect numeric(12,2);
  v_charge_amount numeric(12,2);
  v_allocated_payment numeric(12,2);
  v_allocated_charge numeric(12,2);
BEGIN
  IF NEW.allocated_amount <= 0 THEN
    RAISE EXCEPTION 'Allocation amount must be positive.';
  END IF;

  SELECT greatest(COALESCE(balance_effect,0)-COALESCE(effect_released,0),0)
    INTO v_payment_effect
    FROM public.payments
   WHERE id=NEW.payment_id AND status IS DISTINCT FROM 'Voided'
   FOR UPDATE;
  IF v_payment_effect IS NULL THEN
    RAISE EXCEPTION 'Payment % does not exist or is voided.',NEW.payment_id;
  END IF;

  SELECT amount INTO v_charge_amount FROM public.property_charges
   WHERE id=NEW.property_charge_id AND voided_at IS NULL;
  IF v_charge_amount IS NULL THEN
    RAISE EXCEPTION 'Property charge % does not exist or is voided.',NEW.property_charge_id;
  END IF;

  SELECT COALESCE(sum(allocated_amount),0) INTO v_allocated_payment
    FROM public.property_payment_allocations
   WHERE payment_id=NEW.payment_id
     AND id<>COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid);

  SELECT COALESCE(sum(a.allocated_amount),0) INTO v_allocated_charge
    FROM public.property_payment_allocations a
    JOIN public.payments p ON p.id=a.payment_id AND p.status IS DISTINCT FROM 'Voided'
   WHERE a.property_charge_id=NEW.property_charge_id
     AND a.id<>COALESCE(NEW.id,'00000000-0000-0000-0000-000000000000'::uuid);

  IF v_allocated_payment+NEW.allocated_amount > v_payment_effect+0.005 THEN
    RAISE EXCEPTION 'Allocations for payment % exceed its applied effect (%).',
      NEW.payment_id,v_payment_effect;
  END IF;
  IF v_allocated_charge+NEW.allocated_amount > v_charge_amount+0.005 THEN
    RAISE EXCEPTION 'Allocations for charge % exceed its amount (%).',
      NEW.property_charge_id,v_charge_amount;
  END IF;
  RETURN NEW;
END $body$;

-- BEFORE INSERT already captures receipt_breakdown._application_before; AFTER INSERT
-- this trigger must run BEFORE zzz_record_payment_application alphabetically.
CREATE OR REPLACE FUNCTION payment_allocation_private.record_specific_penalty_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
DECLARE
  v_target_unpaid numeric(12,2);
  v_exists uuid;
BEGIN
  IF NEW.specific_charge_id IS NULL THEN RETURN NEW; END IF;

  IF NEW.status <> 'Completed' OR NEW.charge_type <> 'Penalty / Late Fee'
     OR NEW.amount_paid <= 0 OR NEW.balance_effect IS DISTINCT FROM NEW.amount_paid
     OR NEW.receipt_breakdown ? 'annual_advance_discount'
     OR NEW.receipt_breakdown ? 'manual_cash_discount' THEN
    RAISE EXCEPTION 'A specific penalty requires a completed, undiscounted penalty payment.' USING ERRCODE='22023';
  END IF;

  SELECT c.id INTO v_exists FROM public.property_charges c
  WHERE c.id = NEW.specific_charge_id AND c.property_id = NEW.property_id
    AND c.charge_type = 'Penalty / Late Fee' AND c.voided_at IS NULL FOR UPDATE;
  IF v_exists IS NULL THEN
    RAISE EXCEPTION 'The selected penalty is not active on this property.' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(max((x.item->>'unpaid')::numeric),0) INTO v_target_unpaid
  FROM jsonb_array_elements(COALESCE(NEW.receipt_breakdown->'_application_before','[]'::jsonb)) AS x(item)
  WHERE x.item->>'kind' = 'penalty'
    AND x.item->>'ref_id' = NEW.specific_charge_id::text;

  IF NEW.amount_paid > v_target_unpaid + 0.005 THEN
    RAISE EXCEPTION 'The selected penalty has only PHP % outstanding; requested PHP %.',
      v_target_unpaid, NEW.amount_paid USING ERRCODE='22023';
  END IF;

  INSERT INTO public.property_payment_allocations
    (payment_id,property_charge_id,allocated_amount,allocation_note,created_by)
  VALUES (NEW.id,NEW.specific_charge_id,NEW.amount_paid,
    'Staff-selected specific penalty; original receipt retained',NEW.recorded_by);
  RETURN NEW;
END $body$;

CREATE TRIGGER y_record_specific_penalty_allocation
AFTER INSERT ON public.payments FOR EACH ROW
EXECUTE FUNCTION payment_allocation_private.record_specific_penalty_allocation();

-- A targeted allocation cannot silently move to a different charge later.
CREATE OR REPLACE FUNCTION payment_allocation_private.protect_specific_payment_target()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $body$
BEGIN
  IF NEW.specific_charge_id IS DISTINCT FROM OLD.specific_charge_id THEN
    RAISE EXCEPTION 'A recorded payment target cannot be changed; void and re-record if necessary.';
  END IF;
  IF OLD.status='Voided' AND NEW.status IS DISTINCT FROM 'Voided'
     AND OLD.specific_charge_id IS NOT NULL THEN
    RAISE EXCEPTION 'A voided specific-charge payment must be re-recorded rather than restored.';
  END IF;
  RETURN NEW;
END $body$;
CREATE TRIGGER y_protect_specific_payment_target
BEFORE UPDATE ON public.payments FOR EACH ROW
EXECUTE FUNCTION payment_allocation_private.protect_specific_payment_target();

-- Otherwise voiding a charge would orphan the exact settlement and break the ledger.
CREATE OR REPLACE FUNCTION payment_allocation_private.prevent_void_of_paid_target()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $body$
BEGIN
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.specific_charge_id=OLD.id AND p.status IS DISTINCT FROM 'Voided'
  ) THEN
    RAISE EXCEPTION 'Void the active payments assigned to this charge before voiding the charge.';
  END IF;
  RETURN NEW;
END $body$;
CREATE TRIGGER y_prevent_void_of_paid_target
BEFORE UPDATE OF voided_at ON public.property_charges FOR EACH ROW
EXECUTE FUNCTION payment_allocation_private.prevent_void_of_paid_target();

DO $postflight$
DECLARE v_changes bigint;
BEGIN
  SELECT count(*) INTO v_changes FROM (
    (SELECT * FROM _specific_penalty_before
      EXCEPT ALL SELECT property_id,kind,ref_id,original,unpaid FROM public.property_balance_items)
    UNION ALL
    (SELECT property_id,kind,ref_id,original,unpaid FROM public.property_balance_items
      EXCEPT ALL SELECT * FROM _specific_penalty_before)
  ) changes;
  IF v_changes<>0 OR EXISTS (
    SELECT 1 FROM public.financial_invariant_report WHERE abs(reconciliation_difference)>0.005
  ) THEN
    RAISE EXCEPTION 'Targeted allocation migration changed % historical ledger rows or failed reconciliation.',v_changes;
  END IF;
END $postflight$;
