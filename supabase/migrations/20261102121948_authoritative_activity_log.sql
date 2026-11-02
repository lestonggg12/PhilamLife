-- Activity Log audit AL-1 through AL-8: authoritative future events only.
-- Existing settings, accounts, history and financial balances are not rewritten.
begin;
set local lock_timeout='5s';

do $$begin
 if to_regprocedure('public.write_required_balance_audit(text,text)') is null then
  raise exception 'Install the required activity audit helper before this migration.';
 end if;
end$$;

-- Preserve the active-staff SELECT policy. No browser may invent authoritative events.
revoke insert,update,delete on public.activity_log from public,anon,authenticated;
revoke insert(id,user_id,action,target,created_at),update(id,user_id,action,target,created_at)
 on public.activity_log from public,anon,authenticated;
drop policy if exists "Staff can create own activity" on public.activity_log;

create or replace function public.stamp_activity_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'') not in ('admin','secretary','treasurer')
    or new.user_id is distinct from auth.uid() then
  raise exception using errcode='42501',message='Activity events require their verified active staff actor.';
 end if;
 new.created_at:=statement_timestamp();
 return new;
end;
$$;
revoke all on function public.stamp_activity_event() from public,anon,authenticated;
create or replace trigger a_stamp_activity_event before insert on public.activity_log
 for each row execute function public.stamp_activity_event();

-- All signed-in business events are mandatory, not best-effort.
-- Existing unattended money jobs retain their separate mandatory system journals.
create or replace function public.write_audit_log(p_action text,p_target text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then
  if p_action in ('Payment Recorded','Payment Voided','Charge Added','Charge Voided','Charge Restored',
                  'Service Payment Recorded','Service Balance Collected','Service Receipt Voided')
     and session_user in ('postgres','supabase_admin')
     and coalesce(current_setting('role',true),'none') not in ('anon','authenticated') then
   return;
  end if;
  raise exception using errcode='42501',message='An active staff actor is required to record this activity.';
 end if;
 perform public.write_required_balance_audit(p_action,p_target);
end;
$$;
revoke all on function public.write_audit_log(text,text) from public,anon,authenticated;

create or replace function public.audit_settings_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare diff text;
begin
  select string_agg(n.key || ': ' || coalesce(o.value, 'empty') || ' → ' || coalesce(n.value, 'empty'), '; ' order by n.key)
    into diff
    from jsonb_each_text(to_jsonb(new)) n
    join jsonb_each_text(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value
     and n.key not in ('updated_at', 'updated_by');
  if diff is not null then
    perform public.write_required_balance_audit('Settings Updated', left(diff, 500));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_settings_change() from public, anon, authenticated;


-- One audit event per changed management row. Financial balance-only updates
-- are excluded: their existing payment/charge/balance journals remain responsible.
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
create or replace trigger audit_property_management after insert or update or delete on public.properties
 for each row execute function public.audit_management_change();
create or replace trigger audit_block_management after insert or update or delete on public.blocks
 for each row execute function public.audit_management_change();
create or replace trigger audit_event_management after insert or update or delete on public.events
 for each row execute function public.audit_management_change();
create or replace trigger audit_service_management after insert or update or delete on public.amenity_services
 for each row execute function public.audit_management_change();
-- Deletion already has its required audit in finish_document_deletion().
create or replace trigger audit_document_upload after insert on public.documents
 for each row execute function public.audit_management_change();

-- This records a verifiable request, never a claim that a download completed.
create or replace function public.record_data_export_request(p_scope text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'')<>'admin' then
  raise exception using errcode='42501',message='Only an active Admin can request an application data export.';
 end if;
 if p_scope is null or p_scope not in ('payments','service_transactions','expenses','properties','profiles',
                                      'activity_log','ledger','admin_application_data') then
  raise exception using errcode='22023',message='Choose a supported export scope.';
 end if;
 perform public.write_required_balance_audit('Data Export Requested','Requested export: '||p_scope);
 return true;
end;
$$;
revoke all on function public.record_data_export_request(text) from public,anon,authenticated;
grant execute on function public.record_data_export_request(text) to authenticated;

notify pgrst,'reload schema';
commit;
