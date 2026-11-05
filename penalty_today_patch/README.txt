PHILAMLIFE — Same-day Annual Penalty Rate Changes

This package adds an audited Today option to the Annual Penalty Rates settings.
The existing homeowner 5% change scheduled November 6, 2026 is NOT changed merely by installing it.
Once the database migration is deployed, an Admin may choose Today and save a rate
with a reason. Doing so can apply 5% today and supersede the November 6 rule,
while preserving the original scheduled rule and an explicit supersession record.

FILES INSTALLED
  client/src/components/LatePenaltySettings.jsx   (patched)
  client/src/components/LatePenaltySettings.css   (patched)
  supabase/migrations/20261105214500_same_day_penalty_rate_override.sql (new)

INSTALL FROM REPO ROOT
  node .\penalty_today_patch\apply-penalty-today.cjs

VERIFY CLIENT
  cd client
  npm run build
  npx vitest run

RELEASE ORDER
  1) Confirm you are on the intended branch; review the SQL migration.
  2) Run Supabase migrations against a preview/staging database FIRST.
  3) Verify the migration and rate selection with the read-only queries below.
  4) Deploy migration to production using your reviewed migration workflow.
  5) Deploy the updated frontend after the backend is ready.
  6) In Admin System Settings, select Today and provide a reason before saving.

POST-MIGRATION READ-ONLY CHECK
  SELECT * FROM public.annual_penalty_rate_choice('homeowner',
    timezone('Asia/Manila',now())::date);

AFTER ADMIN SAVES TODAY
  SELECT r.property_classification, r.effective_from, r.annual_rate,
         r.rule_note, s.rule_id AS superseded_future_rule_id
  FROM public.annual_penalty_rate_overrides r
  LEFT JOIN public.annual_penalty_rate_supersessions s ON s.override_id = r.id
  ORDER BY r.created_at DESC;

NOTES
- No old annual_penalty_rate_rules rows are edited or deleted.
- The posting procedure uses the override rate and records its override ID
  alongside the original baseline rule reference for audit provenance.
- Existing posted assessments are never recalculated.
- Frontend code requires the database migration to be applied first.
- This package does not perform GitHub commits or pushes, nor does it run SQL.
