-- These three views were replaced by the receipts_period_summary and receipt_active_days
-- functions. Nothing in the database or the app uses them. No CASCADE, so this fails
-- instead of silently dropping anything that depends on them.
drop view if exists public.payments_overview;
drop view if exists public.receipts_overview;
drop view if exists public.receipt_active_dates;