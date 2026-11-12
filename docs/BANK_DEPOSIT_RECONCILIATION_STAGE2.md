# Bank deposit reconciliation: backend validation stage

Supabase mock-data project: migration `20261112121609_require_exact_bank_deposit_receipt_reconciliation.sql` has already been applied. **Do not run it again** on the connected project.

The Treasurer-only `reconcile_bank_deposit` RPC is now guarded by Admin clearance evidence, exact active receipt-link totals, a nonempty link set, revalidation of each cash receipt, and a reconciliation note. The existing deposit audit trigger records status changes.

Rollback-only database integration checks passed for pending deposits, incomplete matches, Secretary denial, successful exact-total reconciliation, and duplicate finalization. Original mock payment rows were not modified; no test deposits remain.

**Release limitation:** The frontend Reconcile control intentionally remains disabled pending authenticated Admin/Treasurer/Secretary browser-session tests, service-receipt fixtures, and concurrent allocation review. This SQL does not independently verify actual bank statements. Keep PR #4 under review until those checks are complete.
