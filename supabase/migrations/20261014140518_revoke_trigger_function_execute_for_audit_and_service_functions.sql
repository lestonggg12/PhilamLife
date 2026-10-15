begin;

-- These routines are database trigger handlers, not application RPC endpoints.
-- PostgreSQL checks EXECUTE when a trigger is created; revoking API-role EXECUTE
-- does not stop existing triggers from firing.
revoke execute on function public.audit_payment_change() from public, anon, authenticated;
revoke execute on function public.audit_charge_change() from public, anon, authenticated;
revoke execute on function public.audit_service_change() from public, anon, authenticated;
revoke execute on function public.audit_settings_change() from public, anon, authenticated;
revoke execute on function public.dedupe_client_audit() from public, anon, authenticated;
revoke execute on function public.prepare_service_transaction() from public, anon, authenticated;

commit;;
