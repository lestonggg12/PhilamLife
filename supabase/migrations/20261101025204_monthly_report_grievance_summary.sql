-- Monthly management reports receive counts only. Secretary-only case/history
-- policies and the detailed grievance_statement RPC remain unchanged.
begin;
create schema if not exists hoa_report_private;
revoke all on schema hoa_report_private from public, anon;
grant usage on schema hoa_report_private to authenticated;

create or replace function hoa_report_private.grievance_counts(p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
 result jsonb;
 report_day date := (now() at time zone 'Asia/Manila')::date;
 cutoff date;
 start_at timestamptz;
 end_at timestamptz;
begin
 if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('admin', 'treasurer', 'secretary') then
   raise exception using errcode = '42501', message = 'Only HOA staff can view report summary counts.';
 end if;
 if p_from is null or p_to is null or p_from > p_to
    or p_from <> date_trunc('month', p_from)::date
    or p_to <> (p_from + interval '1 month - 1 day')::date then
   raise exception 'Choose a complete reporting month.';
 end if;
 -- Current months stop today. Future periods explicitly contain no activity.
 cutoff := least(p_to, report_day);
 if p_from > report_day then
   return jsonb_build_object('from', p_from, 'to', null, 'not_started', true,
     'opening', 0, 'received', 0, 'reopened', 0, 'resolved', 0,
     'dismissed', 0, 'withdrawn', 0, 'closing', 0, 'over_30_days', 0);
 end if;
 start_at := p_from::timestamp at time zone 'Asia/Manila';
 end_at := least((cutoff + 1)::timestamp at time zone 'Asia/Manila', now());
 with opening as (
   select distinct on (case_id) case_id, status
   from public.grievance_events where recorded_at < start_at
   order by case_id, recorded_at desc, id desc
 ), ending as (
   select distinct on (case_id) case_id, status, snapshot
   from public.grievance_events where recorded_at < end_at
   order by case_id, recorded_at desc, id desc
 ), movement as (
   select previous_status, status,
     status in ('Resolved','Dismissed','Withdrawn') as is_closed,
     coalesce(previous_status in ('Resolved','Dismissed','Withdrawn'), false) as was_closed
   from public.grievance_events where recorded_at >= start_at and recorded_at < end_at
 ), open_cases as (
   select snapshot from ending where status not in ('Resolved','Dismissed','Withdrawn')
 )
 select jsonb_build_object(
   'from', p_from, 'to', cutoff, 'not_started', false,
   'opening', (select count(*) from opening where status not in ('Resolved','Dismissed','Withdrawn')),
   'received', (select count(*) from movement where previous_status is null),
   'reopened', (select count(*) from movement where was_closed and not is_closed),
   'resolved', (select count(*) from movement where not was_closed and is_closed and status = 'Resolved'),
   'dismissed', (select count(*) from movement where not was_closed and is_closed and status = 'Dismissed'),
   'withdrawn', (select count(*) from movement where not was_closed and is_closed and status = 'Withdrawn'),
   'closing', (select count(*) from open_cases),
   'over_30_days', (select count(*) from open_cases
     where cutoff - ((snapshot->>'filed_at')::timestamptz at time zone 'Asia/Manila')::date > 30)
 ) into result;
 return result;
end $function$;
revoke all on function hoa_report_private.grievance_counts(date, date) from public, anon, authenticated;
grant execute on function hoa_report_private.grievance_counts(date, date) to authenticated;

-- Invoker wrapper is the only Data API endpoint; no raw case data is returned.
create or replace function public.monthly_report_grievances(p_from date, p_to date)
returns jsonb language sql security invoker set search_path = ''
as $function$
 select hoa_report_private.grievance_counts(p_from, p_to);
$function$;
revoke all on function public.monthly_report_grievances(date, date) from public, anon, authenticated;
grant execute on function public.monthly_report_grievances(date, date) to authenticated;
commit;
