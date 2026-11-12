# Bank deposit workflow foundation — proposed patch

## Status
Installed in the connected **mock-data Supabase project** as migration `20261112104953` (`controlled_bank_deposit_workflow`). The frontend and migration are committed on `feature/bank-deposit-controls`, awaiting merge review. Database-level rollback tests passed for mock Admin fund creation and clearance, Treasurer deposit recording, Secretary/Treasurer authorization denials, and blocked final reconciliation. These checks did not create permanent deposits or funds. Browser-session and end-to-end collection matching tests remain incomplete. Final reconciliation is intentionally disabled pending auditable receipt-to-deposit matching.

## Roles (proposed control policy)
- **Admin** creates valid funds; verifies bank clearance against an independent bank-statement reference; may void an *uncleared* deposit with a reason.
- **Treasurer** records pending deposits against a registered fund, then reconciles only after Admin clearance; cannot clear deposits directly.
- **Secretary** can see bank-deposit rows through existing staff SELECT policy but cannot register funds, record deposits, or change deposit status.

This is a proposed separation of duties, not a verified organizational approval policy. Obtain the client's approval before enabling live transactions.

## Database patch
`supabase/migrations/20261112104953_controlled_bank_deposit_workflow.sql`

- Adds `deposit_funds` as an Admin-maintained fund registry and a FK from `bank_deposits.fund_id`.
- Adds clearance, reconciliation and void evidence fields.
- Keeps the table read-only to ordinary app roles; provides role-checked RPCs.
- Existing `audit_extra_bank_deposits` AFTER triggers log deposits and status changes; the fund-registration RPC calls required audit logging directly.
- Does **not** transfer funds, reconcile actual bank statements automatically, touch payment balances, or backfill legacy payment allocations.

## Remaining validation before enabling reconciliation or merging
1. Confirm the proposed Admin/Treasurer/Secretary authorization matrix with the client.
2. Run authenticated browser-session tests for all three roles, including inactive accounts, duplicate references, invalid amounts, and denied operations.
3. Implement auditable receipt-to-deposit matching, including prevention of duplicate use of receipts and exact amount validation; do not enable the final reconciliation RPC before this exists.
4. Verify audit logs and account-period protections using mock data and review GitHub CI results.
5. Do not rerun the already applied migration. Review any future schema changes separately before merging PR #4.

## Applying this repository correction
From the PhilamLife repository root on `feature/bank-deposit-controls`, run `git apply --check <patchfile>` then `git apply <patchfile>`. This updates tracked files only; it does not execute SQL or alter deployed data.
