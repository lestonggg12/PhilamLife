-- Future balance and collection actions only. No historical records are rewritten.
begin;

-- Unlike the legacy best-effort logger, this helper propagates failures.
-- The surrounding business statement and all its balance effects then roll back.
create or replace function public.write_required_balance_audit(p_action text, p_target text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous_flag text := coalesce(nullif(current_setting('app.audit_trigger', true), ''), 'off');
  written integer;
begin
  if actor is null or coalesce(public.current_user_role(), '') not in ('admin','secretary','treasurer') then
    raise exception 'An active staff actor is required to save this action and its activity log.' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('app.audit_trigger', 'on', true);
  insert into public.activity_log(user_id, action, target) values (actor, p_action, p_target);
  get diagnostics written = row_count;
  if written <> 1 then
    raise exception 'The activity log could not be saved. No changes were made.';
  end if;
  perform pg_catalog.set_config('app.audit_trigger', previous_flag, true);
exception when others then
  perform pg_catalog.set_config('app.audit_trigger', previous_flag, true);
  raise;
end;
$$;
revoke all on function public.write_required_balance_audit(text,text) from public, anon, authenticated;

create or replace function public.audit_balance_entry_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_name text; target_text text;
begin
  select p.homeowner_name into owner_name from public.properties p where p.id = new.property_id;
  target_text := coalesce(owner_name, 'Property #' || new.property_id::text)
    || ' — ' || new.category || ' — ₱' || to_char(new.amount, 'FM999,999,999,990.00')
    || ' as of ' || to_char(new.as_of_date, 'YYYY-MM-DD')
    || ' [Balance entry: ' || new.id::text || '; Property: ' || new.property_id::text || ']';
  if tg_op = 'INSERT' then
    if nullif(btrim(new.description), '') is not null then
      target_text := target_text || ' — ' || new.description;
    end if;
    perform public.write_required_balance_audit('Balance Added', target_text);
  elsif old.voided_at is null and new.voided_at is not null then
    perform public.write_required_balance_audit('Balance Voided', target_text || ' — ' || coalesce(new.void_reason, ''));
  end if;
  return new;
end;
$$;
revoke all on function public.audit_balance_entry_change() from public, anon, authenticated;

create or replace trigger audit_balance_entry_change
  after insert or update of voided_at on public.balance_entries
  for each row execute function public.audit_balance_entry_change();

create or replace function public.audit_collection_action_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_name text;
begin
  select p.homeowner_name into owner_name from public.properties p where p.id = new.property_id;
  perform public.write_required_balance_audit('Collection Follow-up Recorded',
    coalesce(owner_name, 'Property #' || new.property_id::text) || ' — ' || new.action_type
    || ' — ' || new.details
    || case when nullif(btrim(new.document_reference), '') is not null
      then ' — Document: ' || new.document_reference else '' end
    || ' [Collection action: ' || new.id::text || '; Property: ' || new.property_id::text || ']');
  return new;
end;
$$;
revoke all on function public.audit_collection_action_insert() from public, anon, authenticated;

create or replace trigger audit_collection_action_insert
  after insert on public.collection_actions
  for each row execute function public.audit_collection_action_insert();

-- Keep the existing payment/service/charge deduplication behavior. Also suppress
-- the old frontend Balance Added copy during rollout. Database events bypass
-- this branch, so distinct balance entries with the same amount both get logged.
create or replace function public.dedupe_client_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.audit_trigger', true), 'off') = 'on' or auth.uid() is null then
    return new;
  end if;
  if new.action = 'Balance Added' and exists (
    select 1 from public.activity_log a
    where a.user_id = new.user_id and a.action = new.action
      and a.created_at > now() - interval '2 minutes'
      and strpos(a.target, new.target || ' [Balance entry: ') = 1
  ) then
    return null;
  end if;
  if new.action in ('Payment Recorded', 'Payment Voided', 'Charge Added', 'Charge Voided',
                    'Service Payment Recorded', 'Service Balance Collected') and exists (
    select 1 from public.activity_log a
    where a.user_id = new.user_id and a.action = new.action
      and a.created_at > now() - interval '2 minutes'
      and split_part(a.target, ' — ', 1) = split_part(new.target, ' — ', 1)
      and (new.action not like 'Charge%' or split_part(a.target, ' — ', 2) = split_part(new.target, ' — ', 2))
  ) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function public.dedupe_client_audit() from public, anon, authenticated;

commit;
