begin;
set local lock_timeout = '5s';

-- Leave all business records and audit events intact. The old client can
-- continue without retry keys while this migration is rolled back.
drop trigger account_activity_balance_added on public.balance_entries;
drop function system_notification_private.observe_balance_added();
drop trigger protect_balance_submission_id on public.balance_entries;
drop function public.protect_balance_submission_id();
drop function public.add_homeowner_lot(bigint,uuid,text,integer,numeric);
alter table public.balance_entries drop column submission_id;

create or replace function public.audit_management_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 before_row jsonb:='{}'::jsonb; after_row jsonb:='{}'::jsonb; record_row jsonb;
 watched text[]; event_action text; event_target text; difference text;
begin
 if tg_op<>'INSERT' then before_row:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
 record_row:=case when tg_op='DELETE' then before_row else after_row end;
 case tg_table_name
 when 'properties' then
  watched:=array['homeowner_name','homeowner_id','block','lot_number','lot_size_sqm',
    'contact_phone','contact_email','homeowner_status','status_effective_date','status_reason'];
  event_action:=case when tg_op='INSERT' then 'Homeowner Added' when tg_op='DELETE' then 'Homeowner Removed'
    when after_row->>'homeowner_status'='moved' and before_row->>'homeowner_status' is distinct from after_row->>'homeowner_status' then 'Homeowner Moved'
    when (before_row - array['contact_phone','contact_email','contact_updated_at'])=(after_row - array['contact_phone','contact_email','contact_updated_at']) then 'Contact Updated'
    else 'Homeowner Updated' end;
  event_target:=coalesce(record_row->>'homeowner_name','Unknown homeowner')||' — '
    ||coalesce(record_row->>'block','Unknown block')||', Lot '||coalesce(record_row->>'lot_number','?');
 when 'blocks' then
  watched:=array['name'];
  event_action:=case tg_op when 'INSERT' then 'Block Added' when 'DELETE' then 'Block Removed' else 'Block Renamed' end;
  event_target:=coalesce(record_row->>'name','Unknown block');
 when 'events' then
  watched:=array['title','description','event_date','start_time','end_time','location'];
  event_action:=case tg_op when 'INSERT' then 'Event Scheduled' when 'DELETE' then 'Event Deleted' else 'Event Updated' end;
  event_target:=coalesce(record_row->>'title','Unknown event')||' — '||coalesce(record_row->>'event_date','Unknown date');
 when 'amenity_services' then
  watched:=array['name','description','rate','rate_unit','is_active'];
  event_action:=case tg_op when 'INSERT' then 'Service Added' when 'DELETE' then 'Service Removed' else 'Service Updated' end;
  event_target:=coalesce(record_row->>'name','Unknown service');
 when 'documents' then
  watched:=array['title','category','storage_path','original_file_name','mime_type','file_size'];
  event_action:='Document Uploaded';
  event_target:=coalesce(record_row->>'title','Unknown document')||' — '||coalesce(record_row->>'original_file_name','Unknown filename');
 else raise exception 'Unsupported management audit table.';
 end case;
 select string_agg(k||': '||coalesce(before_row->>k,'empty')||' → '||coalesce(after_row->>k,'empty'),'; ' order by k)
  into difference from unnest(watched) k where before_row->k is distinct from after_row->k;
 if difference is null then return null; end if;
 if tg_op='UPDATE' then event_target:=event_target||' — '||difference; end if;
 perform public.write_required_balance_audit(event_action,event_target);
 return null;
end;
$$;
revoke all on function public.audit_management_change() from public,anon,authenticated;

commit;
