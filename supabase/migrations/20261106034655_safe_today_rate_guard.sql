-- Follow-up migration: restrict same-day rate override writes to classifications
-- with ACTUAL percentage changes; the unchanged classification's future rules
-- must not be silently superseded. Also date-scope historical selections.
-- This is a new migration after 20261105214500, not a replacement for it.

DO $protect$
DECLARE
  body text;
  old_cond text := 'IF v_current IS DISTINCT FROM v_requested OR v_supersedable>0 THEN';
  new_cond text := 'IF v_current IS DISTINCT FROM v_requested THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body FROM pg_proc p
  WHERE p.oid = 'public.set_annual_penalty_rates_today(numeric,numeric,text,uuid,uuid)'::regprocedure;
  IF position(old_cond IN body)=0 OR position(new_cond IN body)>0 THEN
    RAISE EXCEPTION 'Same-day RPC baseline differs; no changes applied.';
  END IF;
  EXECUTE replace(body,old_cond,new_cond);
END;
$protect$;

-- An override must not affect lookups for dates before its effective day.
-- This function is deliberately invoker-mode; the assessment posting RPC
-- executes it as the definer, while direct API clients lack EXECUTE.
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.annual_penalty_rate_supersessions s
        JOIN public.annual_penalty_rate_overrides o ON o.id = s.override_id
        WHERE s.rule_id = r.id AND o.effective_from <= p_on
      )
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
  ORDER BY c.effective_from DESC, c.created_at DESC,
           (c.rate_override_id IS NOT NULL) DESC
  LIMIT 1;
$choice$;
REVOKE ALL ON FUNCTION public.annual_penalty_rate_choice(text,date) FROM PUBLIC, anon, authenticated;
