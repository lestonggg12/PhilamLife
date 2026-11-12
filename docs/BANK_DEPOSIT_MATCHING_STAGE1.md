# Bank-deposit receipt matching — stage 1

This patch builds a **controlled receipt-matching foundation**, not completed bank reconciliation. The final `reconcile_bank_deposit` RPC stays disabled, even when amounts match. **Do not merge or apply the schema without a rollback-based database test and browser-role tests.**

## What changed

- `20261112120000_bank_deposit_receipt_matching.sql` creates an auditable link table and Treasurer-only link/unlink RPCs.
- Cash homeowner receipts use `COALESCE(payments.amount_paid, payments.amount)`, not necessarily their billed `payments.amount`. Service receipts use `service_transactions.amount_paid`.
- A receipt can be partially assigned across deposits but its active allocations cannot exceed its paid amount. A deposit's active allocations cannot exceed its entered amount. Source row locking serializes competing allocations.
- Removed links remain as inactive audit records with a reason and actor. A pending deposit with active links must be unlinked before Admin voiding.
- The bank-deposit page gains an exact receipt-number search and match-management section for Treasurer. Admin and Secretary cannot create matches.

## Limitations and checks before release

1. Apply the migration to the existing mock-data environment only after testing its SQL in a transaction that rolls back. **Do not rerun the already-installed `20261112104953` migration.**
2. Log in separately as Admin, Treasurer and Secretary. Verify that only Treasurer can add/remove links and only Admin can clear deposits.
3. Verify cash receipts, voided receipts, discounts, partial matches, duplicate links, over-allocation, missing receipts, wrong account roles, and concurrent transactions.
4. Verify mandatory audit records when creating/removing a link and rollback when audit writing fails.
5. Test what happens if a previously linked payment or service transaction is voided. The final reconciliation workflow must check linked receipt validity again and detect post-reconciliation changes.
6. Final reconciliation must require deposit status `cleared`, exact source total = deposit amount, validated receipt status, and sufficient independent bank-statement evidence. It is deliberately **not enabled by this patch**.
7. The UI shows only 200 recent deposits; it is not an all-period export or authoritative bank statement.

No historical receipt/payment values are modified, and no mock transactions are inserted by the migration itself.
