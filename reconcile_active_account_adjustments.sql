-- PhilamLife mock/test database: reconcile active account adjustments
-- This migration is safe to re-run: it detects the corrected view and exits.
-- It changes reporting only. It does not update charges, payments, or balances.
DO $migration$
DECLARE
  existing_definition text;
  old_expression constant text :=
    '(context.opening_balance + context.property_charged_amount - context.property_applied_amount)::numeric(12,2) AS expected_current_balance';
  new_expression constant text :=
    '(context.opening_balance + context.property_charged_amount - context.property_applied_amount'
    || E'\n              + COALESCE((SELECT SUM(a.balance_effect)'
    || E'\n                  FROM public.account_adjustments a'
    || E'\n                  WHERE a.property_id = context.property_id AND a.reversed_at IS NULL), 0)'
    || E'\n            )::numeric(12,2) AS expected_current_balance';
BEGIN
  SELECT pg_get_viewdef('public.payment_charge_allocation_audit'::regclass, true)
  INTO existing_definition;
  IF position('FROM public.account_adjustments' IN existing_definition) > 0 THEN
    RAISE NOTICE 'Reconciliation view already includes active account adjustments.';
    RETURN;
  END IF;
  IF position(old_expression IN existing_definition) = 0 THEN
    RAISE EXCEPTION 'Unrecognized reconciliation view definition; manual review required';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.payment_charge_allocation_audit'
      || ' WITH (security_invoker = true) AS '
      || replace(existing_definition, old_expression, new_expression);
END
$migration$;
