-- Reconciliation tables are application-readable audit data.
-- Only the migration/service role should be able to change them.

revoke all on table public.property_payment_allocations from authenticated;
grant select on table public.property_payment_allocations to authenticated;

revoke all on table public.moved_account_reconciliations from authenticated;
grant select on table public.moved_account_reconciliations to authenticated;

