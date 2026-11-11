# PhilamLife — specific-penalty payment review

**Scope:** A staff member may choose one *currently unpaid*, posted `Penalty / Late Fee` charge. That payment settles the selected charge instead of following the account-wide pool waterfall. Leaving the optional target blank preserves the existing automatic allocation behavior.

## Why this cannot be a UI-only change

`property_balance_items` currently pools ordinary association-dues payments and penalty payments together. Its *system-derived* payment snapshots reflect changes in that view. A receipt label alone cannot guarantee a specific penalty is settled; it could leave the penalty outstanding and change next year's compounding basis.

## Migration design

- Adds `payments.specific_charge_id`, normally `NULL`; historical payments are not changed.
- Uses `z_capture_pre_payment_items` to validate the target's *actual unpaid amount* at payment receipt. A new `y_record_specific_penalty_allocation` AFTER INSERT trigger records the target and applies it **before** `zzz_record_payment_application` computes the receipt snapshot.
- The ledger view removes only the cash of *active targeted payments* from the usual pooled payment waterfall, and removes precisely that amount from the selected charge's unpaid balance. It continues returning the original gross/net-of-CCTV charge amount in `original` and keeps regular payments untouched.
- Voiding the targeted payment restores charge unpaid, retains the receipt and original audit snapshot, and excludes the voided explicit allocation from the active ledger. The allocation validator excludes voided receipts when checking a charge's remaining settlement capacity, allowing a replacement payment.
- Charge voids are blocked while a completed targeted payment still points at that charge. Restoring a voided targeted payment is blocked; re-recording is required to avoid ambiguous priority and audit history.
- The migration fails if existing explicit allocations need review, baseline financial invariants fail, the underlying generated view SQL differs from the version audited, or any original ledger item's unpaid amount changes during installation.

## Tests already run in Supabase, all rolled back

- The replacement view preserved every existing ledger item's `original` and `unpaid` in a before/after `EXCEPT ALL` comparison.
- For a posted synthetic annual penalty of PHP 32.94, an explicitly targeted PHP 20 payment reduced the penalty to PHP 12.94, and the item snapshot recorded PHP 20 against the penalty rather than older dues.
- The account balance reconciled after settlement.
- Voiding the targeted payment restored the penalty to PHP 32.94, preserved its audit snapshot, and reconciled.
- A replacement payment of PHP 32.94 correctly settled that penalty after the first targeted payment was voided; the validator did not count the voided allocation.
- A separate general balance payment continued using the original settlement waterfall, and attempting to void an actively targeted charge was blocked.

**No schema migration or fixture payment was committed.** The exact migration file has not been deployed, and frontend behavior plus cross-property rejection still need full staging integration. Database preview tests used equivalent transactionally installed objects; they were not a persistent migration deployment. The provided SQL regression test is designed to execute all of these within a rolled-back transaction *after* the migration is installed on a mock test environment.

## Before promoting

1. **Apply the patch only to a review branch or a working copy**. Do not push it to `main`: GitHub-to-Supabase deployment may auto-apply the migration.
2. Review the migration, especially its strict `pg_get_viewdef` replacements. Confirm current PostgreSQL view text still matches the migration's three expected fragments. A future view rewrite must be merged intentionally, not silently overwritten.
3. Install the migration in a controlled mock environment, then run `supabase/tests/specific_penalty_payment_regression.sql` (it uses `BEGIN` / `ROLLBACK`). Check it completes without SQL errors; rerun financial reconciliation afterward.
4. Run `npm --prefix client test` and `npm --prefix client run build`. Test the payment form for both **General balance allocation** and a **specific penalty** on desktop and mobile.
5. Validate discount, annual advance, CCTV, partial settlement, returned change and void workflows remain unchanged. Ensure receipt numbers, amounts and payment pool totals reconcile before and after.

### Known limitations

- The first version intentionally supports **one explicitly selected posted penalty charge per receipt**, not arbitrary multiple charges. The generic payment waterfall is unchanged.
- No automatic backfill of historical allocation evidence is attempted.
- Historical general payments may appear to satisfy a newly posted penalty under the original waterfall. New specific-charge functionality doesn't retroactively assign them; this warrants a separate policy discussion.
- This is a **controlled review artifact**, not authorization to deploy a financial schema migration.
