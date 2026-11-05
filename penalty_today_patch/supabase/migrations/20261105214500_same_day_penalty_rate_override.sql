-- Same-day penalty rate overrides and audited supersession of future schedules.
-- This migration never modifies or deletes immutable historical rate-rule rows.

CREATE TABLE IF NOT EXISTS public.annual_penalty_rate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_classification text NOT NULL CHECK (property_classification IN ('lot_owner','homeowner')),
  effective_from date NOT NULL,
  annual_rate numeric(8,6) NOT NULL CHECK (annual_rate >= 0 AND annual_rate <= 1),
  rule_note text NOT NULL CHECK (length(btrim(rule_note)) BETWEEN 5 AND 1000),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT annual_penalty_override_classification_date_unique UNIQUE (property_classification, effective_from)
);

CREATE TABLE IF NOT EXISTS public.annual_penalty_rate_supersessions (
  rule_id uuid PRIMARY KEY REFERENCES public.annual_penalty_rate_rules(id),
  override_id uuid NOT NULL REFERENCES public.annual_penalty_rate_overrides(id),
  superseded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.annual_penalty_rate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annual_penalty_rate_supersessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.annual_penalty_rate_overrides FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.annual_penalty_rate_supersessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.annual_penalty_rate_overrides TO authenticated;
GRANT SELECT ON public.annual_penalty_rate_supersessions TO authenticated;

CREATE POLICY "Staff can read same-day penalty rate overrides"
  ON public.annual_penalty_rate_overrides FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin','secretary','treasurer'));
CREATE POLICY "Staff can read superseded penalty rate references"
  ON public.annual_penalty_rate_supersessions FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin','secretary','treasurer'));

-- Both audit tables are append-only, just like the original versioned rate rules.
CREATE TRIGGER annual_penalty_overrides_immutable
  BEFORE UPDATE OR DELETE ON public.annual_penalty_rate_overrides
  FOR EACH ROW EXECUTE FUNCTION public.prevent_annual_penalty_rate_rule_mutation();
CREATE TRIGGER annual_penalty_supersessions_immutable
  BEFORE UPDATE OR DELETE ON public.annual_penalty_rate_supersessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_annual_penalty_rate_rule_mutation();

-- Audit reference for the exact same-day override that established an assessed rate.
ALTER TABLE public.annual_penalty_assessments
  ADD COLUMN IF NOT EXISTS rate_override_id uuid REFERENCES public.annual_penalty_rate_overrides(id);

-- Use the underlying original rule as FK provenance, plus the override ID if any.
-- New future versions remain eligible, but superseded future rules are ignored.
CREATE OR REPLACE FUNCTION public.annual_penalty_rate_choice(
  p_property_classification text, p_on date
)
RETURNS TABLE(base_rule_id uuid, annual_rate numeric, rate_override_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $choice$
  SELECT c.base_rule_id, c.annual_rate, c.rate_override_id
  FROM (
    SELECT r.id AS base_rule_id, r.annual_rate, NULL::uuid AS rate_override_id,
           r.effective_from, r.created_at
    FROM public.annual_penalty_rate_rules r
    WHERE r.property_classification = p_property_classification
      AND r.effective_from <= p_on
      AND NOT EXISTS (SELECT 1 FROM public.annual_penalty_rate_supersessions s WHERE s.rule_id=r.id)
    UNION ALL
    SELECT (
      SELECT r.id FROM public.annual_penalty_rate_rules r
      WHERE r.property_classification=o.property_classification
        AND r.effective_from <= o.effective_from
      ORDER BY r.effective_from DESC, r.created_at DESC LIMIT 1
    ) AS base_rule_id, o.annual_rate, o.id AS rate_override_id,
    o.effective_from, o.created_at
    FROM public.annual_penalty_rate_overrides o
    WHERE o.property_classification=p_property_classification
      AND o.effective_from <= p_on
  ) c
  ORDER BY c.effective_from DESC,c.created_at DESC
  LIMIT 1;
$choice$;
REVOKE ALL ON FUNCTION public.annual_penalty_rate_choice(text,date) FROM PUBLIC, anon, authenticated;

-- A separately authorized RPC for immediate changes, keeping existing future-only
-- set_annual_penalty_rates() behavior intact.
CREATE OR REPLACE FUNCTION public.set_annual_penalty_rates_today(
  p_lot_owner_rate numeric, p_homeowner_rate numeric, p_reason text,
  p_expected_lot_rule_id uuid, p_expected_home_rule_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $today$
DECLARE
  v_actor uuid := auth.uid();
  v_today date := public.hoa_manila_today();
  v_reason text := btrim(coalesce(p_reason,''));
  v_lot_rule uuid;
  v_home_rule uuid;
  v_kind text;
  v_requested numeric;
  v_current numeric;
  v_override_id uuid;
  v_existing_today uuid;
  v_future integer;
  v_count integer := 0;
  v_count_superseded integer := 0;
  v_total_superseded integer := 0;
BEGIN
  IF v_actor IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only an active Admin can change same-day penalty rates.';
  END IF;
  IF length(v_reason) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Enter a reason between 5 and 1000 characters.';
  END IF;
  IF p_lot_owner_rate IS NULL OR p_homeowner_rate IS NULL OR
     p_lot_owner_rate NOT BETWEEN 0 AND 1 OR p_homeowner_rate NOT BETWEEN 0 AND 1 OR
     p_lot_owner_rate <> round(p_lot_owner_rate,6) OR
     p_homeowner_rate <> round(p_homeowner_rate,6) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Each rate must be 0% to 100% with at most four decimal percentage places.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(2062,8615);
  SELECT id INTO v_lot_rule FROM public.annual_penalty_rate_rules
    WHERE property_classification='lot_owner' ORDER BY effective_from DESC LIMIT 1;
  SELECT id INTO v_home_rule FROM public.annual_penalty_rate_rules
    WHERE property_classification='homeowner' ORDER BY effective_from DESC LIMIT 1;
  IF v_lot_rule IS NULL OR v_home_rule IS NULL OR
     v_lot_rule IS DISTINCT FROM p_expected_lot_rule_id OR
     v_home_rule IS DISTINCT FROM p_expected_home_rule_id THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Penalty rules changed. Refresh System Settings before saving.';
  END IF;

  FOR v_kind,v_requested IN
    SELECT * FROM (VALUES ('lot_owner'::text,p_lot_owner_rate),('homeowner'::text,p_homeowner_rate)) AS requested(kind, rate)
  LOOP
    SELECT c.annual_rate INTO v_current FROM public.annual_penalty_rate_choice(v_kind,v_today) c;
    IF v_current IS NULL THEN RAISE EXCEPTION 'Missing current penalty rate for %',v_kind; END IF;
    SELECT count(*) INTO v_future FROM public.annual_penalty_rate_rules r
      WHERE r.property_classification=v_kind AND r.effective_from>v_today
        AND NOT EXISTS (SELECT 1 FROM public.annual_penalty_rate_supersessions s WHERE s.rule_id=r.id);
    IF v_current IS DISTINCT FROM v_requested OR v_future>0 THEN
      SELECT id INTO v_existing_today FROM public.annual_penalty_rate_overrides
        WHERE property_classification=v_kind AND effective_from=v_today;
      IF v_existing_today IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='A same-day override already exists for this classification. Schedule another date instead.';
      END IF;
      INSERT INTO public.annual_penalty_rate_overrides(
        property_classification,effective_from,annual_rate,rule_note,created_by
      ) VALUES (v_kind,v_today,v_requested,v_reason,v_actor)
      RETURNING id INTO v_override_id;
      INSERT INTO public.annual_penalty_rate_supersessions(rule_id,override_id)
        SELECT r.id,v_override_id FROM public.annual_penalty_rate_rules r
        WHERE r.property_classification=v_kind AND r.effective_from>v_today
          AND NOT EXISTS (SELECT 1 FROM public.annual_penalty_rate_supersessions s WHERE s.rule_id=r.id);
      GET DIAGNOSTICS v_count_superseded=ROW_COUNT;
      v_total_superseded:=v_total_superseded+v_count_superseded;
      v_count:=v_count+1;
      PERFORM public.write_audit_log('Same-Day Annual Penalty Rate Override',
        format('classification=%s previous_rate=%s new_rate=%s effective=%s superseded_future_rules=%s override_id=%s reason=%s',
          v_kind,v_current,v_requested,v_today,v_count_superseded,v_override_id,v_reason));
    END IF;
  END LOOP;
  IF v_count=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Rates are unchanged and there is no future schedule to supersede.';
  END IF;
  RETURN jsonb_build_object('effective_from',v_today,'overrides_created',v_count,
                            'future_rules_superseded',v_total_superseded);
END;
$today$;
REVOKE ALL ON FUNCTION public.set_annual_penalty_rates_today(numeric,numeric,text,uuid,uuid)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_annual_penalty_rates_today(numeric,numeric,text,uuid,uuid)
  TO authenticated;

-- Keep existing posting logic byte-for-byte except the rate source and
-- explicit override provenance. Abort if this database's source differs.
DO $patch$
DECLARE
  v_source text;
  v_old text := $old$
    select r.id,r.annual_rate into v_rate_rule_id,configured_rate
      from public.annual_penalty_rate_rules r
      where r.property_classification=p.property_classification and r.effective_from<=today
      order by r.effective_from desc limit 1;$old$;
  v_new text := $new$
    select r.base_rule_id,r.annual_rate,r.rate_override_id
      into v_rate_rule_id,configured_rate,v_override_id
      from public.annual_penalty_rate_choice(p.property_classification,today) r;$new$;
  v_journal_old text := 'origin,rate_rule_id)';
  v_journal_new text := 'origin,rate_rule_id,rate_override_id)';
  v_values_old text := 'end,v_rate_rule_id);';
  v_values_new text := 'end,v_rate_rule_id,v_override_id);';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_source
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='post_due_penalties';
  IF v_source IS NULL OR position(v_old IN v_source)=0 OR
     position(v_journal_old IN v_source)=0 OR position(v_values_old IN v_source)=0 OR
     position('v_rate_rule_id uuid;' IN v_source)=0 THEN
    RAISE EXCEPTION 'Existing penalty posting function differs from migration baseline. No changes applied.';
  END IF;
  v_source:=replace(v_source,'v_rate_rule_id uuid;',
                    'v_rate_rule_id uuid;'||E'\n  v_override_id uuid;');
  v_source:=replace(v_source,v_old,v_new);
  v_source:=replace(v_source,v_journal_old,v_journal_new);
  v_source:=replace(v_source,v_values_old,v_values_new);
  EXECUTE v_source;
END;
$patch$;
