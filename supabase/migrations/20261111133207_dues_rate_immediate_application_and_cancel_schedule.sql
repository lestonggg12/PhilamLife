-- Admin immediate monthly rate changes and cancellation of unapplied future schedules.
-- SQL is synchronized to a migration applied to the connected mock database.
CREATE OR REPLACE FUNCTION public.apply_association_dues_rate_now(p_rate numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_month date := date_trunc('month', public.hoa_manila_today())::date;
  v_prior numeric;
  v_adjusted integer := 0;
  v_prepaid integer := 0;
  v_flag text;
  v_audited integer;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Admin can apply a dues rate immediately.';
  END IF;
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate >= 10000000000
     OR p_rate <> round(p_rate,2) OR p_rate IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Enter a positive rate below PHP 10 billion with at most two decimal places.';
  END IF;

  -- Coordinate with the billing scheduler and other settings operations.
  PERFORM 1 FROM public.system_settings WHERE id=1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Billing settings are missing.'; END IF;
  v_prior := public.association_dues_rate_for_month(v_month);

  -- Lock accounts before assessing balances; payment/charge writes use this lock.
  PERFORM p.id FROM public.properties p
    WHERE p.homeowner_status='active' ORDER BY p.id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.financial_invariant_report r
      WHERE r.homeowner_status='active' AND abs(r.reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Accounts are not reconciled. Review the ledger before applying a rate.';
  END IF;

  -- Prepaid annual contracts keep the original fixed monthly assessment.
  SELECT count(*)::integer INTO v_prepaid FROM public.property_charges c
    WHERE c.billing_month=v_month AND c.charge_type='Association Dues' AND c.voided_at IS NULL
      AND EXISTS (SELECT 1 FROM public.active_annual_dues_coverage a
          WHERE a.property_id=c.property_id AND v_month>=a.starts_on AND v_month<a.ends_before);

  WITH target AS MATERIALIZED (
    SELECT c.id AS charge_id,c.property_id,c.amount AS old_amount,
      public.compute_monthly_dues(p.lot_size_sqm,p_rate) AS desired_amount
    FROM public.property_effective_charges c
    JOIN public.properties p ON p.id=c.property_id
    WHERE c.billing_month=v_month AND c.charge_type='Association Dues'
      AND p.homeowner_status='active' AND p.lot_size_sqm>0
      AND NOT EXISTS (
        SELECT 1 FROM public.active_annual_dues_coverage a
        WHERE a.property_id=c.property_id AND v_month>=a.starts_on AND v_month<a.ends_before
      )
  ), posted AS (
    INSERT INTO public.account_adjustments (
       property_id,charge_id,adjustment_type,balance_effect,reason,approval_reference,created_by)
    SELECT t.property_id,t.charge_id,'monthly_dues_reprice',t.desired_amount-t.old_amount,
      format('%s dues adjusted from PHP %s to PHP %s at PHP %s/sqm (effective now).',
        to_char(v_month,'FMMonth YYYY'),t.old_amount,t.desired_amount,p_rate),
      'Dues rate immediate '||to_char(v_month,'YYYY-MM'),auth.uid()
    FROM target t WHERE t.desired_amount IS DISTINCT FROM t.old_amount
    RETURNING property_id,balance_effect
  )
  UPDATE public.properties p SET current_balance=p.current_balance+posted.balance_effect
  FROM posted WHERE p.id=posted.property_id;
  GET DIAGNOSTICS v_adjusted=ROW_COUNT;

  -- A current-month effective row overrides the future-only scheduling guard.
  INSERT INTO public.association_dues_rates(effective_month,price_per_sqm,updated_by)
    VALUES(v_month,p_rate,auth.uid())
  ON CONFLICT (effective_month) DO UPDATE SET
    price_per_sqm=excluded.price_per_sqm,updated_by=excluded.updated_by,updated_at=now()
  WHERE public.association_dues_rates.price_per_sqm IS DISTINCT FROM excluded.price_per_sqm;

  UPDATE public.system_settings
    SET price_per_sqm=p_rate,updated_by=auth.uid()
  WHERE id=1 AND price_per_sqm IS DISTINCT FROM p_rate;

  IF EXISTS (SELECT 1 FROM public.financial_invariant_report r
      WHERE r.homeowner_status='active' AND abs(r.reconciliation_difference)>0.005) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Rate update did not reconcile; no changes were committed.';
  END IF;

  IF v_prior IS DISTINCT FROM p_rate OR v_adjusted>0 THEN
    v_flag:=current_setting('app.audit_trigger',true);
    PERFORM set_config('app.audit_trigger','on',true);
    INSERT INTO public.activity_log(user_id,action,target)
    VALUES(auth.uid(),'Association Dues Rate Applied Now',
      format('%s: PHP %s/sqm to PHP %s/sqm. %s existing charges adjusted; %s prepaid charges preserved.',
        to_char(v_month,'FMMonth YYYY'),v_prior,p_rate,v_adjusted,v_prepaid));
    GET DIAGNOSTICS v_audited=ROW_COUNT;
    PERFORM set_config('app.audit_trigger',coalesce(v_flag,'off'),true);
    IF v_audited<>1 THEN RAISE EXCEPTION 'Rate change audit entry missing.'; END IF;
  END IF;
  RETURN jsonb_build_object('effective_month',v_month,'previous_rate',v_prior,
    'new_rate',p_rate,'adjusted_charges',v_adjusted,'prepaid_unchanged',v_prepaid);
END $fn$;
REVOKE ALL ON FUNCTION public.apply_association_dues_rate_now(numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_association_dues_rate_now(numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_scheduled_association_dues_rate(p_effective_month date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_old numeric; v_flag text; v_audited integer;
BEGIN
 IF auth.uid() IS NULL OR public.current_user_role()<>'admin' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only an active Admin may cancel scheduled dues rates.';
 END IF;
 PERFORM 1 FROM public.system_settings WHERE id=1 FOR UPDATE;
 IF p_effective_month IS NULL OR NOT isfinite(p_effective_month)
    OR extract(day FROM p_effective_month)<>1
    OR p_effective_month<public.next_association_dues_month()
    OR EXISTS(SELECT 1 FROM public.property_charges c
       WHERE c.charge_type='Association Dues' AND c.billing_month>=p_effective_month) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Only unapplied future rate schedules can be cancelled. Current issued billing must be corrected using Apply Now.';
 END IF;
 DELETE FROM public.association_dues_rates
 WHERE effective_month=p_effective_month RETURNING price_per_sqm INTO v_old;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Scheduled rate not found. Refresh settings.'; END IF;
 v_flag:=current_setting('app.audit_trigger',true);
 PERFORM set_config('app.audit_trigger','on',true);
 INSERT INTO public.activity_log(user_id,action,target)
 VALUES(auth.uid(),'Association Dues Rate Schedule Cancelled',
   format('%s scheduled PHP %s/sqm rate cancelled before billing.',to_char(p_effective_month,'FMMonth YYYY'),v_old));
 GET DIAGNOSTICS v_audited=ROW_COUNT;
 PERFORM set_config('app.audit_trigger',coalesce(v_flag,'off'),true);
 IF v_audited<>1 THEN RAISE EXCEPTION 'Cancellation audit entry missing.'; END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.cancel_scheduled_association_dues_rate(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_association_dues_rate(date) TO authenticated;
