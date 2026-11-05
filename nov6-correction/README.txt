PHILAMLIFE — November 6 same-day annual penalty correction
=========================================================

This is a follow-up to the previously installed "Today" frontend and the
UNAPPLIED migration 20261105214500_same_day_penalty_rate_override.sql.

Fixes:
- A same-day override can supersede an immutable original rule effective ON
  November 6, 2026, not only rules whose dates are after that day.
- The form also recognizes an unchanged percentage when an original rule
  effective today needs to be superseded (with a reason and audit record).
- After a successful override, the form reloads the actual active rate.
- UI help text reflects the true same-day behavior.
- Posted penalties retain their original rate_rule_id plus optional override ID.

This package DOES NOT deploy to Supabase or write to GitHub.

Install steps (PowerShell, from the repository root):
  $root = (git rev-parse --show-toplevel).Trim()
  Set-Location $root
  # Extract the ZIP to a new location (e.g. $root\nov6-correction)
  node .\nov6-correction\apply-nov6-correction.cjs
  cd client
  npm run build
  npx vitest run
  cd ..
  npx supabase db push --remote --dry-run

Expected pending migration: 20261105214500_same_day_penalty_rate_override.sql

STOP before the actual database push; the SQL is for production and needs a
review of the complete migration and backup strategy before deployment.

If frontend was restored with git restore, the installer will refuse to run.
Reinstall original Today component first, then apply this follow-up correction.
