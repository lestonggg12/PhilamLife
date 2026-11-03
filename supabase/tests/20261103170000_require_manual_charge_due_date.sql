-- Emergency rollback of Stage 2 only.
-- No billing functions were modified in Stage 2, so they need no restoration.
-- Preserves all Stage 1 schema, charge due dates, and historical records.
begin;
set local lock_timeout = '5s';

drop trigger if exists require_manual_charge_due_date on public.property_charges;
drop function if exists public.require_manual_charge_due_date();

commit;