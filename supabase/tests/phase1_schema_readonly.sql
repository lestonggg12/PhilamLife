-- Read-only schema verification. Execute on an ISOLATED TEST database after migration.
-- Do NOT use this as a substitute for authenticated role and concurrency tests.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='properties' AND column_name='property_classification') AS classification_column_exists,
  to_regclass('public.property_classification_history') IS NOT NULL AS history_exists,
  to_regprocedure('public.classify_property(bigint,text,text,date)') IS NOT NULL AS rpc_exists,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.property_classification_history'::regclass) AS history_rls_enabled;
