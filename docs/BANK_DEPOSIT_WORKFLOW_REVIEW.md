# Bank deposit workflow foundation — proposed patch

## Status
Prepared only. **NOT deployed to Supabase**, not committed to GitHub and not wired to a production UI. Review and test in a disposable staging Supabase project first. The repository has a `bank_deposits` table with no corresponding fund registry, no application write policy and no deposit-recording frontend screen. Live deposits: 0 at inspection.

## Roles (proposed control policy)
- **Admin** creates valid funds; verifies bank clearance against an independent bank-statement reference; may void an *uncleared* deposit with a reason.
- **Treasurer** records pending deposits against a registered fund, then reconciles only after Admin clearance; cannot clear deposits directly.
- **Secretary** can see bank-deposit rows through existing staff SELECT policy but cannot register funds, record deposits, or change deposit status.

This is a proposed separation of duties, not a verified organizational approval policy. Obtain the client's approval before enabling live transactions.

## Database patch
`supabase/migrations/20261112090000_controlled_bank_deposit_workflow.sql`

- Adds `deposit_funds` as an Admin-maintained fund registry and a FK from `bank_deposits.fund_id`.
- Adds clearance, reconciliation and void evidence fields.
- Keeps the table read-only to ordinary app roles; provides role-checked RPCs.
- Existing `audit_extra_bank_deposits` AFTER triggers log deposits and status changes; the fund-registration RPC calls required audit logging directly.
- Does **not** transfer funds, reconcile actual bank statements automatically, touch payment balances, or backfill legacy payment allocations.

## Before production deployment
1. Confirm authorization matrix with client (who verifies clearance and who reconciles).
2. Exercise Admin, Treasurer, Secretary, inactive and anon role tests **in staging**; verify successful pending -> cleared -> reconciled and declined invalid transitions.
3. Inspect triggers and audit logs in staging; test duplicate reference, invalid fund/date/amount, concurrent requests, and rollback on audit failure.
4. Build and test a suitable UI for Admin fund configuration, Treasurer deposit entry, Admin statement verification, and Treasurer reconciliation. No production user can use this SQL on its own without the UI.
5. Run migration with the normal Supabase migration workflow, and recheck advisors. Never manually invent bank statements or recreate historical allocations.

## Applying patch to repo
From your actual PhilamLife repository on D: (`git rev-parse --show-toplevel`), run `git apply --check <patchfile>` then `git apply <patchfile>`. Do not apply the database migration to production until the prerequisites above are met.
