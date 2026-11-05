-- PHILAMLIFE Phase 1C - ISOLATED TEST DATABASE ONLY.
-- REVIEW AND APPROVE TARGET PROJECT ID BEFORE EXECUTION.
-- No financial data manipulation. All schema and function changes are transactional.
-- This migration intentionally leaves legacy properties Unclassified.
-- Every Unclassified active property is skipped by the yearly penalty posting path.
-- Production activation requires separate approval and regression verification.
--
-- NEVER paste or execute on an unverified project; never use db push / db reset.
BEGIN;

-- Capture financial invariants inside this transaction, before any changes.
CREATE TEMP TABLE phase1c_financial_before ON COMMIT DROP AS
SELECT
 (SELECT count(*) FROM public.properties) AS properties_count,
 (SELECT coalesce(sum(current_balance), 0) FROM public.properties) AS balances_sum,
 (SELECT count(*) FROM public.payments) AS payments_count,
 (SELECT coalesce(sum(amount), 0) FROM public.payments) AS payments_sum,
 (SELECT count(*) FROM public.property_charges) AS charges_count,
 (SELECT coalesce(sum(amount), 0) FROM public.property_charges) AS charges_sum,
 (SELECT count(*) FROM public.late_payment_penalties) AS legacy_penalty_count,
 (SELECT coalesce(sum(penalty_amount), 0) FROM public.late_payment_penalties) AS legacy_penalty_sum,
 (SELECT count(*) FROM public.annual_penalty_assessments) AS annual_assessment_count,
 (SELECT coalesce(sum(penalty_amount),0) FROM public.annual_penalty_assessments) AS annual_assessment_sum,
 (SELECT count(*) FROM public.payment_allocations) AS allocations_count,
 (SELECT count(*) FROM public.account_adjustments) AS adjustment_count;

-- Defend against a changed version of the penalty engine before installing anything.
DO $phase1c_guard$
DECLARE
 v_function text;
 v_needle text := 'where homeowner_status=''active'' and (p_property_id is null or id=p_property_id)';
BEGIN
 IF to_regprocedure('public.post_due_penalties(bigint)') IS NULL THEN
   RAISE EXCEPTION 'Missing post_due_penalties(bigint); abort';
 END IF;
 SELECT pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure) INTO v_function;
 IF (length(v_function)-length(replace(v_function,v_needle,''))) <> length(v_needle) THEN
   RAISE EXCEPTION 'Penalty posting function differs from reviewed baseline; abort';
 END IF;
 IF position('for p in select id,current_balance from public.properties' in v_function) = 0 THEN
   RAISE EXCEPTION 'Unexpected penalty posting query; abort';
 END IF;
END
$phase1c_guard$;

-- Begin reviewed additive Phase 1 draft, within THIS transaction.
DO $$
BEGIN
  IF to_regclass('public.properties') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.current_user_role()') IS NULL
     OR to_regprocedure('public.hoa_manila_today()') IS NULL THEN
    RAISE EXCEPTION 'Phase 1 prerequisites missing; stop and inspect schema';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='properties'
               AND column_name='property_classification') THEN
    RAISE EXCEPTION 'Classification column already exists; inspect before retrying';
  END IF;
END $$;

ALTER TABLE public.properties
  ADD COLUMN property_classification text NOT NULL DEFAULT 'unclassified',
  ADD CONSTRAINT properties_property_classification_check
    CHECK (property_classification IN ('unclassified','lot_owner','homeowner'));

CREATE TABLE public.property_classification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id bigint NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  old_classification text NOT NULL CHECK (old_classification IN ('unclassified','lot_owner','homeowner')),
  new_classification text NOT NULL CHECK (new_classification IN ('unclassified','lot_owner','homeowner')),
  effective_from date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
  CONSTRAINT classification_change_actual CHECK (old_classification <> new_classification),
  CONSTRAINT classification_effective_date_valid CHECK (isfinite(effective_from)),
  CONSTRAINT classification_one_transition_per_day UNIQUE (property_id,effective_from)
);
CREATE INDEX property_classification_history_property_date_idx
  ON public.property_classification_history(property_id,effective_from DESC);

ALTER TABLE public.property_classification_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.property_classification_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.property_classification_history TO authenticated;
CREATE POLICY "Staff read classification history"
  ON public.property_classification_history FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin','secretary','treasurer'));

-- Existing table-level UPDATE grants can include newly added columns.
-- Block direct browser/API modification of the classification column.
-- This is an INVOKER trigger: inside a SECURITY DEFINER RPC, current_user is
-- the trusted database function owner; direct authenticated table writes fail.
CREATE FUNCTION public.guard_property_classification_direct_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('postgres','supabase_admin') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.property_classification IS DISTINCT FROM 'unclassified' THEN
        RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='New properties must start Unclassified; verify through classification workflow.';
      END IF;
    ELSIF NEW.property_classification IS DISTINCT FROM OLD.property_classification THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Use the audited classification operation.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_property_classification_insert
  BEFORE INSERT ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.guard_property_classification_direct_write();
CREATE TRIGGER guard_property_classification_update
  BEFORE UPDATE ON public.properties FOR EACH ROW
  EXECUTE FUNCTION public.guard_property_classification_direct_write();

CREATE FUNCTION public.classify_property(
  p_property_id bigint,
  p_new_classification text,
  p_reason text,
  p_effective_from date
) RETURNS public.property_classification_history
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_property public.properties%ROWTYPE;
  v_event public.property_classification_history%ROWTYPE;
BEGIN
  v_role := public.current_user_role();
  IF v_actor IS NULL OR v_role NOT IN ('admin','secretary') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only active Admin or Secretary may classify a property.';
  END IF;
  IF p_property_id IS NULL OR p_new_classification IS NULL
     OR p_new_classification NOT IN ('unclassified','lot_owner','homeowner') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid property classification request.';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Classification reason must be 5-1000 characters.';
  END IF;
  -- Phase 1 intentionally forbids backdating/future dating. Historical
  -- corrections require a separately approved impact-preview workflow.
  IF p_effective_from IS NULL OR p_effective_from <> public.hoa_manila_today() THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Phase 1 allows today (Manila) only; historical corrections require review.';
  END IF;

  SELECT * INTO v_property FROM public.properties
    WHERE id=p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='Property not found.';
  END IF;
  IF v_property.property_classification = p_new_classification THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Property already has this classification.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.property_classification_history
             WHERE property_id=p_property_id AND effective_from=p_effective_from) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='This property already has a classification change today; review history.';
  END IF;

  INSERT INTO public.property_classification_history
    (property_id,old_classification,new_classification,effective_from,recorded_by,reason)
  VALUES (p_property_id,v_property.property_classification,p_new_classification,p_effective_from,v_actor,btrim(p_reason))
  RETURNING * INTO v_event;

  UPDATE public.properties SET property_classification=p_new_classification
    WHERE id=p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property classification update was not verified';
  END IF;
  RETURN v_event;
END $$;

-- New function EXECUTE is granted to PUBLIC by default; revoke explicitly.
REVOKE ALL ON FUNCTION public.classify_property(bigint,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.classify_property(bigint,text,text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.guard_property_classification_direct_write() FROM PUBLIC,anon,authenticated;

-- Defensive privilege check: the trusted RPC owner must be the migration owner.
DO $$
DECLARE v_owner text;
BEGIN
  SELECT pg_get_userbyid(proowner) INTO v_owner
  FROM pg_proc WHERE oid = 'public.classify_property(bigint,text,text,date)'::regprocedure;
  IF v_owner NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'Unexpected classify_property owner: %',v_owner;
  END IF;
END $$;


-- Phase 1C: Preserve the entire existing penalty engine, changing ONLY
-- the active-property selection. The exact old text must match once.
DO $phase1c_patch$
DECLARE
 v_definition text;
 v_old constant text := 'where homeowner_status=''active'' and (p_property_id is null or id=p_property_id)';
 v_new constant text := 'where homeowner_status=''active'' and property_classification <> ''unclassified'' and (p_property_id is null or id=p_property_id)';
BEGIN
 SELECT pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure) INTO v_definition;
 IF v_definition IS NULL OR
    (length(v_definition)-length(replace(v_definition,v_old,''))) <> length(v_old) THEN
   RAISE EXCEPTION 'Penalty function changed during Phase 1C migration; abort';
 END IF;
 EXECUTE replace(v_definition,v_old,v_new);
END
$phase1c_patch$;

-- Verify schema, history protections, permissions and revised function,
-- and ensure financial rows and aggregates have not changed in this transaction.
DO $phase1c_verify$
DECLARE
 v_actual record;
 v_expected record;
 v_definition text;
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='properties'
    AND column_name='property_classification'
 ) OR to_regclass('public.property_classification_history') IS NULL
   OR to_regprocedure('public.classify_property(bigint,text,text,date)') IS NULL
 THEN
   RAISE EXCEPTION 'Classification schema incomplete; rollback';
 END IF;
 SELECT pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure) INTO v_definition;
 IF position('property_classification <> ''unclassified''' in v_definition) = 0 THEN
   RAISE EXCEPTION 'Unclassified posting guard missing; rollback';
 END IF;
 IF (SELECT count(*) FROM public.properties WHERE property_classification='unclassified')
    <> (SELECT count(*) FROM public.properties) THEN
   RAISE EXCEPTION 'Legacy property classifications unexpectedly changed; rollback';
 END IF;
 SELECT * INTO v_expected FROM phase1c_financial_before;
 SELECT
  (SELECT count(*) FROM public.properties) AS properties_count,
  (SELECT coalesce(sum(current_balance), 0) FROM public.properties) AS balances_sum,
  (SELECT count(*) FROM public.payments) AS payments_count,
  (SELECT coalesce(sum(amount), 0) FROM public.payments) AS payments_sum,
  (SELECT count(*) FROM public.property_charges) AS charges_count,
  (SELECT coalesce(sum(amount), 0) FROM public.property_charges) AS charges_sum,
  (SELECT count(*) FROM public.late_payment_penalties) AS legacy_penalty_count,
  (SELECT coalesce(sum(penalty_amount), 0) FROM public.late_payment_penalties) AS legacy_penalty_sum,
  (SELECT count(*) FROM public.annual_penalty_assessments) AS annual_assessment_count,
  (SELECT coalesce(sum(penalty_amount),0) FROM public.annual_penalty_assessments) AS annual_assessment_sum,
  (SELECT count(*) FROM public.payment_allocations) AS allocations_count,
  (SELECT count(*) FROM public.account_adjustments) AS adjustment_count
 INTO v_actual;
 IF row_to_json(v_actual)::jsonb IS DISTINCT FROM row_to_json(v_expected)::jsonb THEN
   RAISE EXCEPTION 'Financial baseline changed; rollback';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.property_classification_history'::regclass) THEN
   RAISE EXCEPTION 'Classification history RLS not enabled; rollback';
 END IF;
END
$phase1c_verify$;
COMMIT;

-- Post-migration manual testing: run the companion read-only verification
-- script. Role tests and concurrency tests still require authenticated test accounts.
