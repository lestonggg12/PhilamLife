-- Already applied to Supabase as migration 20261104140518.
-- Allow decimal hours for timed amenity reservations.
-- Existing quantities and receipt amounts are preserved.

alter table public.service_transactions
  alter column quantity type numeric(12,2)
  using quantity::numeric(12,2);