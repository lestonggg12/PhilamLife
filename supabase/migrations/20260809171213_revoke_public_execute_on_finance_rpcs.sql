begin;

revoke execute on function public.record_hoa_payment(bigint, numeric, text, text, text, text, text) from anon, authenticated;
revoke execute on function public.record_account_adjustment(bigint, uuid, text, numeric, text, text) from anon, authenticated;
revoke execute on function public.void_hoa_payment(bigint, text, text) from anon, authenticated;
revoke execute on function public.create_assessment_schedule(text, text, numeric, text, date, text, smallint, smallint, numeric) from anon, authenticated;
revoke execute on function public.approve_assessment_schedule(uuid, text, timestamptz) from anon, authenticated;
revoke execute on function public.close_accounting_period(date, date, text) from anon, authenticated;
revoke execute on function public.post_monthly_assessments(date) from anon, authenticated;
revoke execute on function public.post_due_penalties(date) from anon, authenticated;
revoke execute on function public.current_user_is_admin() from anon;
revoke execute on function public.current_user_role() from anon;
revoke execute on function public.next_service_receipt_number() from anon, authenticated;

grant execute on function public.record_hoa_payment(bigint, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.record_account_adjustment(bigint, uuid, text, numeric, text, text) to authenticated;
grant execute on function public.void_hoa_payment(bigint, text, text) to authenticated;
grant execute on function public.create_assessment_schedule(text, text, numeric, text, date, text, smallint, smallint, numeric) to authenticated;
grant execute on function public.approve_assessment_schedule(uuid, text, timestamptz) to authenticated;
grant execute on function public.close_accounting_period(date, date, text) to authenticated;
grant execute on function public.post_monthly_assessments(date) to authenticated;
grant execute on function public.post_due_penalties(date) to authenticated;
grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.next_service_receipt_number() to authenticated;

commit;
