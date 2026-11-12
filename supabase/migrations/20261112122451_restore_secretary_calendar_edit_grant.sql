-- Already installed in the connected mock-data Supabase project as migration 20261112122451.
-- Restore the missing UPDATE privilege used by the Secretary calendar editor.
-- RLS and prepare_calendar_event() continue to restrict updates to active Secretaries.
GRANT UPDATE ON TABLE public.events TO authenticated;
