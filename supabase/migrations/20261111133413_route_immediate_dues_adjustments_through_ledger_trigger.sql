-- Existing direct balance writes are intentionally blocked by protect_property_balance.
-- Only this audited, trigger-nested financial adjustment may update stored balances.
CREATE OR REPLACE FUNCTION public.apply_monthly_dues_reprice_to_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.adjustment_type<>'monthly_dues_reprice' THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR public.current_user_role()<>'admin'
    OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only an active Admin can post a dues reprice adjustment.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.property_charges c
  WHERE c.id=NEW.charge_id AND c.property_id=NEW.property_id
    AND c.charge_type='Association Dues' AND c.voided_at IS NULL
    AND c.billing_month=date_trunc('month',public.hoa_manila_today())::date) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Dues adjustments must reference active current-month dues.';
 END IF;
 UPDATE public.properties SET current_balance=current_balance+NEW.balance_effect
 WHERE id=NEW.property_id;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.apply_monthly_dues_reprice_to_balance() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zz_apply_monthly_dues_reprice_to_balance ON public.account_adjustments;
CREATE TRIGGER zz_apply_monthly_dues_reprice_to_balance
AFTER INSERT ON public.account_adjustments FOR EACH ROW
WHEN (NEW.adjustment_type='monthly_dues_reprice')
EXECUTE FUNCTION public.apply_monthly_dues_reprice_to_balance();
