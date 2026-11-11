-- Fail closed for SECURITY DEFINER authorization and evaluate RLS role checks once.
-- The function definitions are rewritten from the installed versions so their
-- financial behavior remains unchanged.
DO $migration$
DECLARE
  v_target record;
  v_definition text;
  v_rewritten text;
BEGIN
  FOR v_target IN
    SELECT p.oid, p.oid::regprocedure AS signature
    FROM pg_proc p
    WHERE p.oid IN (
      'public.amend_completed_receipt_note(bigint,text,text)'::regprocedure,
      'public.apply_association_dues_rate_now(numeric)'::regprocedure,
      'public.cancel_scheduled_association_dues_rate(date)'::regprocedure,
      'public.create_cctv_electricity_schedule(bigint,numeric,date,date,text)'::regprocedure,
      'public.record_cash_payment_with_debt_discount(bigint,numeric,numeric,numeric,text,text,text,text,text,uuid)'::regprocedure,
      'public.record_payment_with_optional_discount(bigint,numeric,numeric,text,text,text,text,text,uuid)'::regprocedure,
      'public.record_payment_with_returned_change(bigint,numeric,numeric,numeric,text,text,text,text,text,uuid)'::regprocedure,
      'public.apply_monthly_dues_reprice_to_balance()'::regprocedure
    )
  LOOP
    v_definition := pg_get_functiondef(v_target.oid);
    v_rewritten := replace(v_definition,
      'v_actor IS NULL OR public.current_user_role() NOT IN (',
      'v_actor IS NULL OR coalesce(public.current_user_role(), '''') NOT IN (');
    v_rewritten := replace(v_rewritten,
      'v_actor is null or public.current_user_role() not in (',
      'v_actor is null or coalesce(public.current_user_role(), '''') not in (');
    v_rewritten := replace(v_rewritten,
      'auth.uid() IS NULL OR public.current_user_role() <> ''admin''',
      'auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM ''admin''');
    v_rewritten := replace(v_rewritten,
      'auth.uid() is null or public.current_user_role() <> ''admin''',
      'auth.uid() is null or public.current_user_role() IS DISTINCT FROM ''admin''');
    v_rewritten := replace(v_rewritten,
      'auth.uid() IS NULL OR public.current_user_role()<>''admin''',
      'auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM ''admin''');
    v_rewritten := replace(v_rewritten,
      'auth.uid() is null or public.current_user_role()<>''admin''',
      'auth.uid() is null or public.current_user_role() IS DISTINCT FROM ''admin''');
    v_rewritten := replace(v_rewritten,
      'v_actor IS NULL OR public.current_user_role() <> ''secretary''',
      'v_actor IS NULL OR public.current_user_role() IS DISTINCT FROM ''secretary''');
    v_rewritten := replace(v_rewritten,
      'v_actor is null or public.current_user_role() <> ''secretary''',
      'v_actor is null or public.current_user_role() IS DISTINCT FROM ''secretary''');

    IF v_rewritten = v_definition THEN
      RAISE EXCEPTION 'No authorization guard was rewritten for %.', v_target.signature;
    END IF;
    EXECUTE v_rewritten;
  END LOOP;
END
$migration$;

ALTER POLICY "Active Admin and Treasurer can read approved expense budgets"
  ON public.expense_budgets
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT public.current_user_role()) IN ('admin', 'treasurer')
  );

ALTER POLICY "Secretary and Treasurer can record service transactions"
  ON public.service_transactions
  WITH CHECK (
    (SELECT public.current_user_role()) IN ('secretary', 'treasurer')
    AND recorded_by = (SELECT auth.uid())
  );
