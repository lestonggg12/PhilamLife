-- Run in a staging Supabase project AFTER applying the proposed migration.
-- Read-only catalog checks. This is NOT a substitute for transaction/role testing.
SELECT
  has_function_privilege('authenticated','public.create_deposit_fund(text)','EXECUTE') AS rpc_fund_callable_authenticated,
  has_function_privilege('authenticated','public.record_bank_deposit(uuid,date,text,numeric)','EXECUTE') AS rpc_record_callable_authenticated,
  has_function_privilege('authenticated','public.clear_bank_deposit(uuid,text)','EXECUTE') AS rpc_clear_callable_authenticated,
  has_function_privilege('authenticated','public.reconcile_bank_deposit(uuid,text)','EXECUTE') AS rpc_reconcile_callable_authenticated,
  has_function_privilege('authenticated','public.void_pending_bank_deposit(uuid,text)','EXECUTE') AS rpc_void_callable_authenticated,
  has_table_privilege('authenticated','public.bank_deposits','INSERT') AS direct_insert_granted,
  has_table_privilege('authenticated','public.bank_deposits','UPDATE') AS direct_update_granted,
  has_table_privilege('authenticated','public.bank_deposits','DELETE') AS direct_delete_granted,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.deposit_funds'::regclass) AS registry_rls_on,
  (SELECT count(*) FROM pg_constraint WHERE conrelid='public.bank_deposits'::regclass AND conname='bank_deposits_fund_id_fkey') AS deposit_fund_fk_count;

SELECT c.relname AS table_name,t.tgname AS trigger_name
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE c.oid = 'public.bank_deposits'::regclass AND NOT t.tgisinternal;
