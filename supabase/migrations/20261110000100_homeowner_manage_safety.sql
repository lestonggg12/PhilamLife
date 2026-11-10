begin;
set local lock_timeout = '5s';

-- A lost response or repeated submission must never add the same balance twice.
-- Legacy submissions can continue without a key.
alter table public.balance_entries add column submission_id uuid unique;

create function public.protect_balance_submission_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.submission_id is distinct from old.submission_id then
    raise exception 'A balance submission identifier cannot be changed.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_balance_submission_id() from public, anon, authenticated;
create trigger protect_balance_submission_id before update of submission_id on public.balance_entries
  for each row execute function public.protect_balance_submission_id();

create function system_notification_private.observe_balance_added()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_activity(property_id, dedupe_key, kind, title, body, payload, occurred_at)
  values (
    new.property_id, 'balance_added:' || new.id, 'balance_added', 'Balance entered',
    format('Entered ₱%s for %s, dated %s.%s',
      to_char(new.amount, 'FM999,999,999,990.00'), lower(new.category),
      to_char(new.as_of_date, 'FMMonth FMDD, YYYY'),
      case when new.description is null then '' else ' Note: ' || new.description end),
    jsonb_build_object('actor_name', new.created_by_name, 'entry_id', new.id), new.created_at
  );
  return new;
end;
$$;
revoke all on function system_notification_private.observe_balance_added() from public, anon, authenticated;
create trigger account_activity_balance_added after insert on public.balance_entries
  for each row execute function system_notification_private.observe_balance_added();

-- Mark only this explicit operation as Add Lot. Ownership transfer and new
-- homeowner registration continue to use their existing audit events.
create function public.add_homeowner_lot(
  p_source_property_id bigint, p_expected_homeowner_id uuid,
  p_block text, p_lot_number integer, p_lot_size_sqm numeric
)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  owner_name text;
  new_id bigint;
  previous_flag text := coalesce(current_setting('app.add_homeowner_lot', true), 'off');
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('admin', 'secretary', 'treasurer') then
    raise exception 'An active staff account is required.' using errcode = '42501';
  end if;

  select homeowner_name into owner_name
  from public.properties
  where id = p_source_property_id and homeowner_id = p_expected_homeowner_id
    and homeowner_status = 'active'
  for share;
  if not found then
    raise exception 'The selected account has changed. Refresh before adding a lot.';
  end if;

  perform set_config('app.add_homeowner_lot', 'on', true);
  insert into public.properties(homeowner_id, homeowner_name, block, lot_number, lot_size_sqm)
    values(p_expected_homeowner_id, owner_name, p_block, p_lot_number, p_lot_size_sqm)
    returning id into new_id;
  perform set_config('app.add_homeowner_lot', previous_flag, true);
  return new_id;
end;
$$;
revoke all on function public.add_homeowner_lot(bigint,uuid,text,integer,numeric) from public, anon;
grant execute on function public.add_homeowner_lot(bigint,uuid,text,integer,numeric) to authenticated;

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
  event_action:=case
    when tg_op='INSERT' and current_setting('app.add_homeowner_lot', true)='on' then 'Lot Added'
    when tg_op='INSERT' then 'Homeowner Added' when tg_op='DELETE' then 'Homeowner Removed'
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
