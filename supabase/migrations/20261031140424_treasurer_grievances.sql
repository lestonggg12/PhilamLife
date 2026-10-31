begin;

create table public.grievance_cases (
 id uuid primary key,
 case_number bigint generated always as identity unique,
 title text not null check(length(btrim(title)) between 1 and 160),
 category text not null check(category in ('Noise','Parking','Pets','Maintenance','Neighbor dispute','Dues or payment dispute','Rule violation','Officer conduct','Other')),
 status text not null default 'Received' check(status in ('Received','Under review','In mediation','Awaiting decision','Awaiting action','Referred','Resolved','Dismissed','Withdrawn')),
 complainant text not null check(length(btrim(complainant)) between 1 and 200),
 respondent text not null check(length(btrim(respondent)) between 1 and 200),
 property_id bigint references public.properties(id) on delete restrict,
 homeowner_name text,
 block text,
 lot_number integer,
 location text not null check(length(btrim(location)) between 1 and 300),
 description text not null check(length(btrim(description)) between 1 and 6000),
 requested_action text not null default '' check(length(requested_action)<=3000),
 incident_date date,
 assigned_handler text not null default '' check(length(assigned_handler)<=200),
 follow_up_date date,
 rule_reference text not null default '' check(length(rule_reference)<=1000),
 evidence_notes text not null default '' check(length(evidence_notes)<=4000),
 outcome text not null default '' check(length(outcome)<=4000),
 decision_authority text not null default '' check(length(decision_authority)<=300),
 filed_at timestamptz not null,
 updated_at timestamptz not null,
 version integer not null default 1 check(version>0),
 created_by uuid not null,
 updated_by uuid not null
);
create index grievance_cases_property_idx on public.grievance_cases(property_id);
create index grievance_cases_filed_idx on public.grievance_cases(filed_at desc,id);
create index grievance_cases_status_idx on public.grievance_cases(status,updated_at desc,id);

create table public.grievance_events (
 id bigint generated always as identity primary key,
 case_id uuid not null references public.grievance_cases(id) on delete restrict,
 previous_status text,
 status text not null,
 note text not null check(length(btrim(note)) between 1 and 4000),
 snapshot jsonb not null,
 recorded_at timestamptz not null,
 recorded_by uuid not null,
 recorded_by_name text not null
);
create index grievance_events_case_time_idx on public.grievance_events(case_id,recorded_at desc,id desc);
create index grievance_events_time_idx on public.grievance_events(recorded_at,id);

alter table public.grievance_cases enable row level security;
alter table public.grievance_events enable row level security;
revoke all on public.grievance_cases,public.grievance_events from public,anon,authenticated;
revoke all on sequence public.grievance_cases_case_number_seq,public.grievance_events_id_seq from public,anon,authenticated;
grant select on public.grievance_cases,public.grievance_events to authenticated;
create policy treasurer_grievance_read on public.grievance_cases for select to authenticated
 using ((select auth.uid()) is not null and (select public.current_user_role())='treasurer');
create policy treasurer_grievance_history_read on public.grievance_events for select to authenticated
 using ((select auth.uid()) is not null and (select public.current_user_role())='treasurer');

-- This is the only client write path. The case and its immutable history are
-- saved atomically. No financial tables or payment functions are modified.
create function public.save_grievance(p_case_id uuid,p_expected_version integer,p_details jsonb,p_note text)
returns public.grievance_cases language plpgsql security definer set search_path=''
as $function$
declare
 old_case public.grievance_cases%rowtype;
 saved public.grievance_cases%rowtype;
 lot public.properties%rowtype;
 actor uuid:=auth.uid();
 actor_name text;
 v_now timestamptz:=clock_timestamp();
 closed_statuses text[]:=array['Resolved','Dismissed','Withdrawn'];
 v_status text:=coalesce(p_details->>'status','Received');
 v_property bigint:=nullif(p_details->>'property_id','')::bigint;
 v_incident date:=nullif(p_details->>'incident_date','')::date;
begin
 if actor is null or coalesce(public.current_user_role(),'')<>'treasurer' then
   raise exception using errcode='42501',message='Only the Treasurer can manage grievances.';
 end if;
 if p_case_id is null or p_expected_version is null or p_expected_version<0 then raise exception 'Invalid case request.';end if;
 if jsonb_typeof(p_details) is distinct from 'object' then raise exception 'Enter the case details.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_case_id::text,0));
 select * into old_case from public.grievance_cases where id=p_case_id for update;
 if found then
   if p_expected_version=0 and old_case.created_by=actor then return old_case;end if;
   if old_case.version<>p_expected_version then raise exception 'This case changed since you opened it. Close it, refresh, and try again.';end if;
 else
   if p_expected_version<>0 then raise exception 'Case not found.';end if;
   if v_status<>'Received' then raise exception 'New complaints start as Received.';end if;
 end if;
 if coalesce(length(btrim(p_note)),0) not between 1 and 4000 then raise exception 'Add a note explaining this record or update.';end if;
 if v_incident>(v_now at time zone 'Asia/Manila')::date then raise exception 'The incident date cannot be in the future.';end if;
 if v_status=any(closed_statuses) then
   if coalesce(btrim(p_details->>'outcome'),'')='' then raise exception 'Record the outcome before closing this case.';end if;
   if v_status in ('Resolved','Dismissed') and coalesce(btrim(p_details->>'decision_authority'),'')='' then
     raise exception 'Record who authorized the decision, such as the committee or board resolution.';
   end if;
 end if;
 if old_case.status=any(closed_statuses) and v_status=any(closed_statuses) and old_case.status<>v_status then
   raise exception 'Reopen the case before changing its closing outcome.';
 end if;
 if v_property is not null then
   select * into lot from public.properties where id=v_property;
   if not found then raise exception 'Selected lot was not found.';end if;
 end if;
 select coalesce(nullif(btrim(full_name),''),email,'Treasurer') into actor_name from public.profiles where id=actor;
 insert into public.grievance_cases(id,title,category,status,complainant,respondent,property_id,homeowner_name,block,lot_number,
 location,description,requested_action,incident_date,assigned_handler,follow_up_date,rule_reference,evidence_notes,outcome,decision_authority,
 filed_at,updated_at,version,created_by,updated_by)
 values(p_case_id,btrim(p_details->>'title'),p_details->>'category',v_status,btrim(p_details->>'complainant'),btrim(p_details->>'respondent'),v_property,
 case when v_property is not distinct from old_case.property_id and old_case.id is not null then old_case.homeowner_name else lot.homeowner_name end,
 case when v_property is not distinct from old_case.property_id and old_case.id is not null then old_case.block else lot.block end,
 case when v_property is not distinct from old_case.property_id and old_case.id is not null then old_case.lot_number else lot.lot_number end,
 btrim(p_details->>'location'),btrim(p_details->>'description'),coalesce(btrim(p_details->>'requested_action'),''),v_incident,
 coalesce(btrim(p_details->>'assigned_handler'),''),nullif(p_details->>'follow_up_date','')::date,
 coalesce(btrim(p_details->>'rule_reference'),''),coalesce(btrim(p_details->>'evidence_notes'),''),coalesce(btrim(p_details->>'outcome'),''),
 coalesce(btrim(p_details->>'decision_authority'),''),coalesce(old_case.filed_at,v_now),v_now,coalesce(old_case.version,0)+1,coalesce(old_case.created_by,actor),actor)
 on conflict(id) do update set title=excluded.title,category=excluded.category,status=excluded.status,complainant=excluded.complainant,
 respondent=excluded.respondent,property_id=excluded.property_id,homeowner_name=excluded.homeowner_name,block=excluded.block,lot_number=excluded.lot_number,
 location=excluded.location,description=excluded.description,requested_action=excluded.requested_action,incident_date=excluded.incident_date,
 assigned_handler=excluded.assigned_handler,follow_up_date=excluded.follow_up_date,rule_reference=excluded.rule_reference,evidence_notes=excluded.evidence_notes,
 outcome=excluded.outcome,decision_authority=excluded.decision_authority,updated_at=excluded.updated_at,version=excluded.version,updated_by=excluded.updated_by
 returning * into saved;
 insert into public.grievance_events(case_id,previous_status,status,note,snapshot,recorded_at,recorded_by,recorded_by_name)
 values(saved.id,old_case.status,saved.status,btrim(p_note),to_jsonb(saved),v_now,actor,coalesce(actor_name,'Treasurer'));
 perform public.write_audit_log(case when old_case.id is null then 'Grievance Recorded' else 'Grievance Updated' end,
   'GR-'||saved.case_number||' - '||saved.title||' - '||saved.status);
 return saved;
end $function$;
revoke all on function public.save_grievance(uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_grievance(uuid,integer,jsonb,text) to authenticated;

create function public.grievance_statement(p_from date,p_to date)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare result jsonb; start_at timestamptz; end_at timestamptz;
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'')<>'treasurer' then
   raise exception using errcode='42501',message='Only the Treasurer can view grievance statements.';
 end if;
 if p_from is null or p_to is null or p_from>p_to or p_to>(now() at time zone 'Asia/Manila')::date then raise exception 'Choose a valid reporting period ending today or earlier.';end if;
 start_at:=p_from::timestamp at time zone 'Asia/Manila';
 end_at:=(p_to+1)::timestamp at time zone 'Asia/Manila';
 with opening as (
   select distinct on(case_id) case_id,status from public.grievance_events where recorded_at<start_at order by case_id,recorded_at desc,id desc
 ), ending as (
   select distinct on(case_id) case_id,status,snapshot from public.grievance_events where recorded_at<end_at order by case_id,recorded_at desc,id desc
 ), movement as (
   select *,status in ('Resolved','Dismissed','Withdrawn') as is_closed,
     coalesce(previous_status in ('Resolved','Dismissed','Withdrawn'),false) as was_closed
   from public.grievance_events where recorded_at>=start_at and recorded_at<end_at
 ), open_cases as (
   select *,greatest(0,p_to-((snapshot->>'filed_at')::timestamptz at time zone 'Asia/Manila')::date) as age
   from ending where status not in ('Resolved','Dismissed','Withdrawn')
 ), categories as (
   select snapshot->>'category' as label,count(*) as count from open_cases group by 1 order by 1
 ), states as (
   select status as label,count(*) as count from open_cases group by 1 order by 1
 ), locations as (
   select coalesce(nullif(snapshot->>'block',''),'Common / other location') as label,count(*) as count from open_cases group by 1 order by 1
 )
 select jsonb_build_object(
 'from',p_from,'to',p_to,'generated_at',clock_timestamp(),
 'opening',(select count(*) from opening where status not in ('Resolved','Dismissed','Withdrawn')),
 'received',(select count(*) from movement where previous_status is null),
 'reopened',(select count(*) from movement where was_closed and not is_closed),
 'resolved',(select count(*) from movement where not was_closed and is_closed and status='Resolved'),
 'dismissed',(select count(*) from movement where not was_closed and is_closed and status='Dismissed'),
 'withdrawn',(select count(*) from movement where not was_closed and is_closed and status='Withdrawn'),
 'closing',(select count(*) from open_cases),
 'average_days_to_close',(select round(avg(extract(epoch from (recorded_at-(snapshot->>'filed_at')::timestamptz))/86400),1) from movement where not was_closed and is_closed),
 'categories',coalesce((select jsonb_agg(to_jsonb(categories)) from categories),'[]'::jsonb),
 'statuses',coalesce((select jsonb_agg(to_jsonb(states)) from states),'[]'::jsonb),
 'blocks',coalesce((select jsonb_agg(to_jsonb(locations)) from locations),'[]'::jsonb),
 'aging',jsonb_build_array(
   jsonb_build_object('label','0-30 days','count',(select count(*) from open_cases where age<=30)),
   jsonb_build_object('label','31-60 days','count',(select count(*) from open_cases where age between 31 and 60)),
   jsonb_build_object('label','61-90 days','count',(select count(*) from open_cases where age between 61 and 90)),
   jsonb_build_object('label','Over 90 days','count',(select count(*) from open_cases where age>90)))
 ) into result;
 return result;
end $function$;
revoke all on function public.grievance_statement(date,date) from public,anon,authenticated;
grant execute on function public.grievance_statement(date,date) to authenticated;
commit;
