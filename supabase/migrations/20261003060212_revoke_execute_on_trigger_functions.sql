-- Trigger functions must not be callable through the public API.
revoke execute on function public.apply_charge_to_balance() from public, anon, authenticated;
revoke execute on function public.sync_balance_on_payment_status() from public, anon, authenticated;
