-- PHILAMLIFE Phase 1C READ-ONLY post-install verification.
-- Execute against the ISOLATED test DB after the combined Phase 1C SQL.
-- This script must not POST penalties, call classify_property, or modify rows.
SELECT
  current_database() AS database_name,
  current_user AS executor,
  (SELECT count(*) FROM public.properties) AS properties_count,
  (SELECT count(*) FROM public.properties WHERE property_classification='unclassified') AS unclassified_count,
  (SELECT count(*) FROM public.property_classification_history) AS classifications_logged,
  (SELECT count(*) FROM public.payments) AS payments_count,
  (SELECT count(*) FROM public.late_payment_penalties) AS legacy_penalty_count,
  (SELECT coalesce(sum(current_balance),0) FROM public.properties) AS total_stored_balances,
  (SELECT coalesce(sum(penalty_amount),0) FROM public.late_payment_penalties) AS legacy_penalty_amount;

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='properties'
          AND column_name='property_classification') AS property_classification_present,
  to_regclass('public.property_classification_history') IS NOT NULL AS classification_history_present,
  to_regprocedure('public.classify_property(bigint,text,text,date)') IS NOT NULL AS classification_rpc_present,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.property_classification_history'::regclass) AS history_rls_enabled,
  position('property_classification <> ''unclassified''' in
     pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure)) > 0
     AS posting_skips_unclassified,
  has_function_privilege('anon', 'public.classify_property(bigint,text,text,date)', 'EXECUTE')
     AS anon_cannot_classify_must_be_false,
  has_function_privilege('authenticated', 'public.classify_property(bigint,text,text,date)', 'EXECUTE')
     AS authenticated_can_call_rpc,
  has_table_privilege('authenticated','public.property_classification_history','INSERT')
     AS authenticated_cannot_insert_history_must_be_false;

-- Manual role testing remains required using REAL authenticated test sessions:
-- Admin: classify one synthetic property today with valid reason; event + current status agree.
-- Secretary: same on another synthetic property.
-- Treasurer: classify_property(...) rejected (42501); direct classification UPDATE rejected.
-- Unauthorized/inactive: rejected. Repeated same-day update rejected with 23505.
-- Concurrent staff edits: one succeeds and the second fails, history has one event.
-- Confirm balances/payments/penalties are unchanged before vs after each classification.
-- Never call post_due_penalties() to test the skip against shared/prod data.
