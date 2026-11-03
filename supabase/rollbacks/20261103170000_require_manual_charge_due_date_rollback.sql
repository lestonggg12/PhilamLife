-- Emergency rollback of Stage 2 only.
-- Preserves Stage 1 and all historical records.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS require_manual_charge_due_date
ON public.property_charges;

DROP FUNCTION IF EXISTS public.require_manual_charge_due_date();

COMMIT;
