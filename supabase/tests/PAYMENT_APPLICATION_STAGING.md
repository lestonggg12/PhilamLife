# Payment application evidence — staged verification checklist

This is a **prospective audit enhancement**. It does not convert historical cash
into charge-specific, staff-approved allocations and does not replace the HOA's
existing penalty waterfall. Older payment records remain untouched.

**Test environment decision:** The project owner confirmed that the existing
Supabase project currently holds mock data and declined a separate branch.
Run tests on that designated mock-data project only after a backup/export and
a financial baseline. Its schema still backs the deployed application; do not
run this migration against a project after real homeowner data is introduced.
The migration itself installs recording triggers and is therefore a persistent
schema change, not a rolled-back test. Obtain explicit deployment authorization
before applying it.

1. Apply `20261111040000_record_payment_application_evidence.sql` to the approved
   mock-data project. Check that both tables, their staff-only RLS policies, and three
   triggers exist. Confirm the schema `payment_allocation_private` is not in the
   exposed Data API schemas.
2. Run `payment_application_evidence_regression.sql` on that project. It checks
   the database's actual `calculate_application` function and its guard rules.
3. Create **synthetic** staff and property fixtures in the mock-data project,
   then use the application's authorized payment path for: normal cash,
   future advance, partial, CCTV net charge, annual discounted prepayment,
   explicit manual discount, void, and annual penalty settlement.
4. For each case, compare before/after `property_balance_items`, a saved
   `payment_application_snapshots` row, item snapshots, the receipt's cash,
   `payments.balance_effect`, the current balance, and `financial_invariant_report`.
   Assert no new snapshot is created when an existing payment is voided;
   issuance evidence must retain the status via `payment_application_evidence`.
5. Create a payment and a charge for **different synthetic properties**. Verify
   that attempting `property_payment_allocations` across their IDs fails.
6. Check that no `public.payments` or `public.properties.current_balance`
   rows changed merely by installing the migration. Check that existing receipts
   have no new application metadata and historic allocation tables remain as-is.
7. Test actual receipt UI and ledger exports against the new internal metadata.
   Receipt totals must always show real cash; inferred allocations must be
   labeled **system-derived**, not explicit payment instructions.

A pure-function SQL regression is **not** an end-to-end payment integration test.
Until steps 3–7 pass in the designated mock-data project, this is a review candidate only.

**Deployment dependency:** the new AFTER payment trigger will fail closed if an
unexpected change in `property_balance_items` makes an item more unpaid during
payment. The isolated tests must cover the full order of payment and annual
coverage triggers before deploying.
