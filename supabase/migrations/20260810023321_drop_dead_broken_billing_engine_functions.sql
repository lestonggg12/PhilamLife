drop function if exists public.void_hoa_payment(bigint, text, text);
drop function if exists public.record_account_adjustment(bigint, uuid, text, numeric, text, text);
drop function if exists public.close_accounting_period(date, date, text);
drop function if exists public.post_monthly_assessments(date);
drop function if exists public.post_due_penalties(date);
drop function if exists public.approve_assessment_schedule(uuid, text, timestamptz);
drop function if exists public.create_assessment_schedule(text, text, numeric, text, date, text, smallint, smallint, numeric);
