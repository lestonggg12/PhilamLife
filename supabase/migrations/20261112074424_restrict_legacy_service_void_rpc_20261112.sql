-- Already applied to Philam System Project on November 12, 2026.
-- Keep this file in supabase/migrations to align source history with the live database.
-- The frontend uses void_service_receipt(uuid,text); the older endpoint has no current UI consumers.
REVOKE EXECUTE ON FUNCTION public.void_service_transaction(uuid,text)
FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.void_service_transaction(uuid,text) IS
  'Legacy service void endpoint retained for historical compatibility; execution revoked from application roles. Use public.void_service_receipt(uuid,text).';
