-- Annual penalties on Association Dues must age from the scheduled monthly
-- billing day, NOT the first day of the billing month (which is only the
-- accounting period key). Preserve the historical charge and payment journal.
--
-- A scheduled_bill_on snapshot is stored on each charge at creation so a
-- subsequent change to Settings > billing day cannot retroactively move its
-- penalty anniversary. This also handles months shorter than the selected day.

DO $preflight$
DECLARE
  v_day integer;
BEGIN
  SELECT billing_day INTO STRICT v_day FROM public.system_settings WHERE id = 1;
  IF v_day NOT BETWEEN 1 AND 31 THEN
    RAISE EXCEPTION 'Invalid monthly billing day (%). No penalty dates changed.', v_day;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.annual_penalty_schedules s
    LEFT JOIN public.property_charges c
      ON c.id=s.source_ref AND c.property_id=s.property_id
    WHERE s.source_kind='dues' AND
      (c.id IS NULL OR c.charge_type<>'Association Dues'
       OR c.billing_month IS NULL OR c.billing_month<>date_trunc('month',c.billing_month)::date
       OR s.as_of_date<>c.billing_month OR s.next_anniversary_no<>1)
  ) THEN
    RAISE EXCEPTION 'Existing monthly dues penalty schedules differ from the expected unassessed first-month state. Review before migrating.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.annual_penalty_assessments a
    JOIN public.annual_penalty_schedules s ON s.id=a.schedule_id
    WHERE s.source_kind='dues'
  ) THEN
    RAISE EXCEPTION 'Monthly dues penalties have already been assessed; do not change their anniversary dates automatically.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_invariant_report
             WHERE abs(reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION 'Financial reconciliation failed before the penalty date migration.';
  END IF;
END
$preflight$;

ALTER TABLE public.property_charges ADD COLUMN scheduled_bill_on date;

-- Populate existing monthly charge anchors without altering financial values.
-- Historical October/November 2026 dues are tied to the documented billing-day
-- setting; any contradictory schedules are rejected by the preflight above.
UPDATE public.property_charges c
SET scheduled_bill_on = c.billing_month +
  (least(s.billing_day, extract(day from
      (c.billing_month + interval '1 month - 1 day'))::integer) - 1)
FROM public.system_settings s
WHERE s.id=1 AND c.charge_type='Association Dues'
  AND c.billing_month IS NOT NULL;

ALTER TABLE public.property_charges
  ADD CONSTRAINT association_dues_scheduled_bill_on_valid CHECK (
    charge_type<>'Association Dues' OR billing_month IS NULL OR
    (scheduled_bill_on IS NOT NULL AND scheduled_bill_on>=billing_month AND
      scheduled_bill_on < (billing_month + interval '1 month')::date)
  );

-- Capture the setting at the time each future monthly charge is inserted.
-- The billing engine and any legitimate backfill use the same rule.
CREATE OR REPLACE FUNCTION public.stamp_association_dues_scheduled_bill_on()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_day integer;
BEGIN
  IF NEW.charge_type='Association Dues' AND NEW.billing_month IS NOT NULL THEN
    IF NEW.billing_month<>date_trunc('month',NEW.billing_month)::date THEN
      RAISE EXCEPTION 'Association dues billing_month must be the first of its month.';
    END IF;
    SELECT billing_day INTO STRICT v_day FROM public.system_settings WHERE id=1;
    IF v_day NOT BETWEEN 1 AND 31 THEN
      RAISE EXCEPTION 'Invalid billing day; charge was not posted.';
    END IF;
    NEW.scheduled_bill_on:= NEW.billing_month +
      (least(v_day,extract(day from
        (NEW.billing_month + interval '1 month - 1 day'))::integer)-1);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.stamp_association_dues_scheduled_bill_on()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_stamp_association_dues_scheduled_bill_on
  BEFORE INSERT ON public.property_charges
  FOR EACH ROW EXECUTE FUNCTION public.stamp_association_dues_scheduled_bill_on();

-- The policy date is immutable after charge creation, even on later void/restore.
CREATE OR REPLACE FUNCTION public.guard_association_dues_scheduled_bill_on()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  IF NEW.scheduled_bill_on IS DISTINCT FROM OLD.scheduled_bill_on THEN
    RAISE EXCEPTION 'The original scheduled billing date is immutable.';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_association_dues_scheduled_bill_on()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_guard_association_dues_scheduled_bill_on
  BEFORE UPDATE ON public.property_charges
  FOR EACH ROW EXECUTE FUNCTION public.guard_association_dues_scheduled_bill_on();

-- The existing penalty posting function inserts schedules using billing_month
-- (the first). Rewrite only the NEW schedule's as_of_date before insertion;
-- post_due_penalties then reads the stored scheduled date for every anniversary.
-- No changes to the penalty posting function or its permission model are needed.
CREATE OR REPLACE FUNCTION public.stamp_monthly_dues_penalty_anchor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_bill_date date;
BEGIN
  IF NEW.source_kind='dues' THEN
    SELECT c.scheduled_bill_on INTO v_bill_date
    FROM public.property_charges c
    WHERE c.id=NEW.source_ref AND c.property_id=NEW.property_id
      AND c.charge_type='Association Dues';
    IF v_bill_date IS NULL THEN
      RAISE EXCEPTION 'Missing monthly dues charge billing date for annual penalty schedule.';
    END IF;
    NEW.as_of_date:=v_bill_date;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.stamp_monthly_dues_penalty_anchor()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_stamp_monthly_dues_penalty_anchor
  BEFORE INSERT ON public.annual_penalty_schedules
  FOR EACH ROW EXECUTE FUNCTION public.stamp_monthly_dues_penalty_anchor();

-- An immutable audit of dates amended by this migration. No cash movements,
-- receipts, charge amounts, credit adjustments or completed assessments change.
CREATE TABLE public.annual_penalty_anchor_corrections (
  schedule_id uuid PRIMARY KEY REFERENCES public.annual_penalty_schedules(id) ON DELETE RESTRICT,
  property_id bigint NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  source_charge_id uuid NOT NULL REFERENCES public.property_charges(id) ON DELETE RESTRICT,
  billing_month date NOT NULL,
  old_anchor date NOT NULL,
  corrected_anchor date NOT NULL,
  policy_billing_day integer NOT NULL CHECK (policy_billing_day BETWEEN 1 AND 31),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'Align annual dues penalty anniversary with scheduled monthly billing day'
);
ALTER TABLE public.annual_penalty_anchor_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.annual_penalty_anchor_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.annual_penalty_anchor_corrections TO authenticated;
CREATE POLICY "Staff read anniversary correction audit"
  ON public.annual_penalty_anchor_corrections FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('admin','treasurer','secretary'));

INSERT INTO public.annual_penalty_anchor_corrections
  (schedule_id,property_id,source_charge_id,billing_month,old_anchor,corrected_anchor,policy_billing_day)
SELECT a.id,a.property_id,c.id,c.billing_month,a.as_of_date,c.scheduled_bill_on,s.billing_day
FROM public.annual_penalty_schedules a
JOIN public.property_charges c ON c.id=a.source_ref AND c.property_id=a.property_id
CROSS JOIN public.system_settings s
WHERE a.source_kind='dues' AND c.charge_type='Association Dues' AND s.id=1
  AND a.as_of_date<>c.scheduled_bill_on;

UPDATE public.annual_penalty_schedules a
SET as_of_date=cor.corrected_anchor
FROM public.annual_penalty_anchor_corrections cor
WHERE a.id=cor.schedule_id AND a.as_of_date=cor.old_anchor;

-- Fail transactionally if even one schedule was not fixed, or any balance moved.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.annual_penalty_schedules a
    JOIN public.property_charges c ON c.id=a.source_ref AND c.property_id=a.property_id
    WHERE a.source_kind='dues' AND c.charge_type='Association Dues'
      AND a.as_of_date IS DISTINCT FROM c.scheduled_bill_on
  ) THEN
    RAISE EXCEPTION 'Annual penalty anniversary migration did not correct all dues schedules; rolled back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.financial_invariant_report
             WHERE abs(reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION 'Financial reconciliation changed during penalty anniversary migration; rolled back.';
  END IF;
END
$verify$;
