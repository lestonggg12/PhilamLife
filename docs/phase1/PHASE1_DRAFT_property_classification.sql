-- PHILAMLIFE Phase 1 — REVIEW-ONLY DRAFT, not authorized for production execution.
-- Apply ONLY to a disposable local database or separately approved isolated staging.
-- Do not activate this feature against the live penalty engine: post_due_penalties()
-- currently ignores property classification. Phase 2 must enforce Unclassified skip.
-- No payment, charge, penalty, receipt, credit or balance rows are touched.
BEGIN;

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

COMMIT;
