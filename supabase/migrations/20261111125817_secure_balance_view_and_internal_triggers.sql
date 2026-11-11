-- Existing migration already applied to the connected Supabase test project.
-- Ensure balance details obey the caller's RLS permissions.
ALTER VIEW public.property_balance_items SET (security_invoker = true);

-- Trigger-only handlers must not be callable directly via public RPC endpoints.
REVOKE EXECUTE ON FUNCTION public.apply_cctv_electricity_credit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_cctv_electricity_credit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_system_settings_revision() FROM PUBLIC, anon, authenticated;
