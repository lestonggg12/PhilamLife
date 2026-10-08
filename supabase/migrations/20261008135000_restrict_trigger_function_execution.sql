-- These functions are invoked by database triggers and are not application RPCs.
-- Keep them executable by the table owner for trigger execution, but do not
-- expose them through the PostgREST API.

revoke execute on function public.check_service_balance_payment() from public, anon, authenticated;
revoke execute on function public.validate_property_payment_allocation() from public, anon, authenticated;

