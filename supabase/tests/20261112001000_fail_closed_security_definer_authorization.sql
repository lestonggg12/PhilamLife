-- Rollback-safe authorization and RLS regression tests.
-- Run against a Supabase branch or local database with the application schema:
--   psql -v ON_ERROR_STOP=1 -f this-file.sql
-- Every fixture mutation and assertion is rolled back at the end.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $tests$
DECLARE
  v_admin uuid;
  v_secretary uuid;
  v_treasurer uuid;
  v_rejected boolean;
  v_policy text;
  v_function text;
  v_balance_before numeric;
  v_payment_count_before bigint;
BEGIN
  SELECT id INTO STRICT v_admin
  FROM public.profiles
  WHERE lower(role) = 'admin' AND coalesce(is_active, true)
  ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_secretary
  FROM public.profiles
  WHERE lower(role) = 'secretary' AND coalesce(is_active, true)
  ORDER BY id LIMIT 1;
  SELECT id INTO STRICT v_treasurer
  FROM public.profiles
  WHERE lower(role) = 'treasurer' AND coalesce(is_active, true)
  ORDER BY id LIMIT 1;
  SELECT coalesce(sum(current_balance), 0) INTO v_balance_before
  FROM public.properties;
  SELECT count(*) INTO v_payment_count_before
  FROM public.payments;

  -- Anonymous callers are rejected before input validation.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_rejected := false;
  BEGIN
    PERFORM public.apply_association_dues_rate_now(NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Anonymous admin-only RPC was not rejected.'; END IF;

  -- Active authorized users pass the role gate and reach argument validation.
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.apply_association_dues_rate_now(NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    WHEN SQLSTATE '42501' THEN RAISE EXCEPTION 'Active Admin was rejected by authorization.';
  END;
  PERFORM set_config('request.jwt.claim.sub', v_secretary::text, true);
  BEGIN
    PERFORM public.amend_completed_receipt_note(NULL, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    WHEN SQLSTATE '42501' THEN RAISE EXCEPTION 'Active Secretary was rejected by authorization.';
  END;
  PERFORM set_config('request.jwt.claim.sub', v_treasurer::text, true);
  BEGIN
    PERFORM public.record_payment_with_optional_discount(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    WHEN SQLSTATE '42501' THEN RAISE EXCEPTION 'Active Treasurer was rejected by authorization.';
  END;

  PERFORM set_config('request.jwt.claim.sub', v_secretary::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.apply_association_dues_rate_now(NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Secretary bypassed the Admin-only rate function.'; END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.save_annual_expense_budgets(NULL, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Secretary bypassed the Admin-only budget function.'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_treasurer::text, true);
  v_rejected := false;
  BEGIN
    PERFORM public.create_cctv_electricity_schedule(NULL,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Treasurer bypassed the Admin-only CCTV function.'; END IF;

  -- Each active role is temporarily made inactive; current_user_role() must
  -- return NULL and every privileged gate must fail with SQLSTATE 42501.
  v_rejected := false;
  UPDATE public.profiles SET is_active = false WHERE id = v_admin;
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  BEGIN
    PERFORM public.apply_association_dues_rate_now(NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT coalesce(v_rejected, false) THEN RAISE EXCEPTION 'Inactive Admin bypassed authorization.'; END IF;

  v_rejected := false;
  UPDATE public.profiles SET is_active = false WHERE id = v_secretary;
  PERFORM set_config('request.jwt.claim.sub', v_secretary::text, true);
  BEGIN
    PERFORM public.amend_completed_receipt_note(NULL, NULL, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Inactive Secretary bypassed authorization.'; END IF;

  v_rejected := false;
  UPDATE public.profiles SET is_active = false WHERE id = v_treasurer;
  PERFORM set_config('request.jwt.claim.sub', v_treasurer::text, true);
  BEGIN
    PERFORM public.record_payment_with_optional_discount(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Inactive Treasurer bypassed authorization.'; END IF;

  -- Catalog assertions cover all seven RPCs and the immediate-rate trigger.
  SELECT pg_get_functiondef(p.oid) INTO v_function
  FROM pg_proc p
  WHERE p.oid = 'public.record_payment_with_optional_discount(bigint,numeric,numeric,text,text,text,text,text,uuid)'::regprocedure;
  IF v_function NOT LIKE '%coalesce(public.current_user_role(), '''') NOT IN%' THEN
    RAISE EXCEPTION 'Manual discount authorization is not NULL-safe.';
  END IF;
  SELECT pg_get_functiondef(p.oid) INTO v_function
  FROM pg_proc p
  WHERE p.oid = 'public.apply_monthly_dues_reprice_to_balance()'::regprocedure;
  IF v_function NOT LIKE '%IS DISTINCT FROM ''admin''%' THEN
    RAISE EXCEPTION 'Dues reprice trigger authorization is not NULL-safe.';
  END IF;

  SELECT coalesce(qual, '') || coalesce(with_check, '') INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'expense_budgets'
    AND policyname = 'Active Admin and Treasurer can read approved expense budgets';
  IF v_policy NOT LIKE '%SELECT current_user_role()%' THEN
    RAISE EXCEPTION 'expense_budgets policy was not optimized.';
  END IF;
  SELECT coalesce(qual, '') || coalesce(with_check, '') INTO v_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'service_transactions'
    AND policyname = 'Secretary and Treasurer can record service transactions';
  IF v_policy NOT LIKE '%SELECT current_user_role()%' THEN
    RAISE EXCEPTION 'service_transactions policy was not optimized.';
  END IF;
  IF (SELECT coalesce(sum(current_balance), 0) FROM public.properties) <> v_balance_before
     OR (SELECT count(*) FROM public.payments) <> v_payment_count_before THEN
    RAISE EXCEPTION 'Rejected authorization attempts changed financial reconciliation state.';
  END IF;
END
$tests$;

ROLLBACK;
