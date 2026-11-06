-- Approved ANNUAL expense allocations, one row per calendar year and
-- established Expenses-page category. Monthly reports use 1/12 of the annual
-- allocation (centavos distributed across months; no premature rounding).
-- Financial transactions are never edited by this migration.
CREATE TABLE public.expense_budgets (
  budget_year integer NOT NULL CHECK (budget_year BETWEEN 2000 AND 2100),
  category text NOT NULL CHECK (category IN (
    'Utilities','Maintenance & Repairs','Security','Salaries & Honoraria',
    'Supplies','Waste Management','Insurance','Events & Community',
    'Professional Fees','Other'
  )),
  approved_annual_amount numeric(14,2) NOT NULL CHECK (approved_annual_amount >= 0),
  approval_note text NOT NULL CHECK (char_length(btrim(approval_note)) BETWEEN 5 AND 1000),
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_year, category)
);

ALTER TABLE public.expense_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.expense_budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.expense_budgets TO authenticated;
CREATE POLICY "Active Admin and Treasurer can read approved expense budgets"
  ON public.expense_budgets FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL AND public.current_user_role() IN ('admin','treasurer'));
-- All writes go through a single, audited and admin-checked RPC, not REST DML.

CREATE OR REPLACE FUNCTION public.save_annual_expense_budgets(
  p_year integer, p_entries jsonb, p_reason text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE
  v_item jsonb;
  v_category text;
  v_raw text;
  v_amount numeric;
  v_old numeric;
  v_changed integer := 0;
  v_actor uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL OR public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an active Admin may approve expense budgets.' USING ERRCODE = '42501';
  END IF;
  IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2100 THEN
    RAISE EXCEPTION 'Budget year must be between 2000 and 2100.';
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'Budget approval/change reason must be 5-1000 characters.';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array'
    OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'Submit 1-10 budget category entries.';
  END IF;
  -- Serialize approvals for one year; no lost concurrent changes.
  PERFORM pg_advisory_xact_lock(2062, p_year);
  IF (SELECT count(DISTINCT item->>'category') FROM jsonb_array_elements(p_entries) item)
       <> jsonb_array_length(p_entries) THEN
    RAISE EXCEPTION 'Duplicate expense budget categories are not allowed.';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR NOT (v_item ? 'category')
      OR NOT (v_item ? 'amount') THEN
      RAISE EXCEPTION 'Each budget entry requires category and amount.';
    END IF;
    v_category := v_item->>'category';
    v_raw := v_item->>'amount';
    IF v_category NOT IN (
      'Utilities','Maintenance & Repairs','Security','Salaries & Honoraria',
      'Supplies','Waste Management','Insurance','Events & Community',
      'Professional Fees','Other') THEN
      RAISE EXCEPTION 'Unknown expense budget category: %', v_category;
    END IF;
    IF v_raw IS NULL OR v_raw !~ '^\d{1,12}(\.\d{1,2})?$' THEN
      RAISE EXCEPTION 'Invalid budget amount for % (maximum two decimals).', v_category;
    END IF;
    v_amount := v_raw::numeric;
    SELECT approved_annual_amount INTO v_old FROM public.expense_budgets
      WHERE budget_year=p_year AND category=v_category;
    IF NOT FOUND OR v_old IS DISTINCT FROM v_amount THEN
      INSERT INTO public.expense_budgets
        (budget_year,category,approved_annual_amount,approval_note,updated_by,updated_at)
      VALUES (p_year,v_category,v_amount,btrim(p_reason),v_actor,now())
      ON CONFLICT (budget_year,category) DO UPDATE SET
        approved_annual_amount=EXCLUDED.approved_annual_amount,
        approval_note=EXCLUDED.approval_note,
        updated_by=EXCLUDED.updated_by,
        updated_at=EXCLUDED.updated_at;
      PERFORM public.write_audit_log('Expense Budget Approved',
        format('Year %s / %s: %s -> %s PHP; reason: %s',
          p_year,v_category,coalesce(v_old::text,'not recorded'),v_amount::text,btrim(p_reason)));
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  RETURN v_changed;
END;
$fn$;
REVOKE ALL ON FUNCTION public.save_annual_expense_budgets(integer,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_annual_expense_budgets(integer,jsonb,text) TO authenticated;
