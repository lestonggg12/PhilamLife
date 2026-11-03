-- Stage 2 regression tests.
-- Run only AFTER applying the reviewed Stage 2 migration.
-- The outer transaction is rolled back, including test charges.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $test$
DECLARE
  test_property_id bigint;
  inserted_id uuid;
  expected_error boolean;
  deadline date := public.hoa_manila_today();
BEGIN
  SELECT id INTO test_property_id
  FROM public.properties
  ORDER BY id
  LIMIT 1;

  IF test_property_id IS NULL THEN
    RAISE EXCEPTION 'No mock property available for testing.';
  END IF;

  -- 1. Manual charge without a due date must fail.
  expected_error := false;
  BEGIN
    INSERT INTO public.property_charges
      (property_id, charge_type, amount, created_by_name)
    VALUES
      (test_property_id, 'Other', 1, 'Stage 2 test');

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%final due date is required%' THEN
      expected_error := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT expected_error THEN
    RAISE EXCEPTION
      'FAIL: manual charge without due date was accepted.';
  END IF;

  -- 2. A past due date must fail.
  expected_error := false;
  BEGIN
    INSERT INTO public.property_charges
      (property_id, charge_type, amount, due_date, created_by_name)
    VALUES
      (test_property_id, 'Other', 1, deadline - 1, 'Stage 2 test');

  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%past final due date%' THEN
      expected_error := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT expected_error THEN
    RAISE EXCEPTION
      'FAIL: manual charge with past due date was accepted.';
  END IF;

  -- 3. A charge due today must succeed.
  INSERT INTO public.property_charges
    (property_id, charge_type, amount, due_date, created_by_name)
  VALUES
    (test_property_id, 'Other', 1, deadline, 'Stage 2 test')
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: valid manual charge was not created.';
  END IF;

  RAISE NOTICE 'PASS: missing, past, and valid due dates.';
END;
$test$;

-- 4. Billing functions must retain SECURITY DEFINER.
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.bill_monthly_dues(date)')
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'Monthly billing function missing or modified.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.post_due_penalties(bigint)')
      AND prosecdef
  ) THEN
    RAISE EXCEPTION 'Annual penalty function missing or modified.';
  END IF;

  RAISE NOTICE 'PASS: billing functions remain SECURITY DEFINER.';
END;
$test$;

-- No test charges or balance changes are retained.
ROLLBACK;
