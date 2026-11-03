-- Phase 1: add identity-verified transfer entry points without changing the
-- existing financial transfer functions or historical records.
-- Deploy this migration BEFORE deploying the frontend patch.
begin;
set local lock_timeout = '5s';

create or replace function public.transfer_homeowner_guarded(
  p_previous_property_id bigint,
  p_expected_homeowner_id uuid,
  p_new_homeowner_name text,
  p_effective_date date,
  p_note text default null
)
returns table(new_property_id bigint, transferred_balance numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  current_owner uuid;
  current_status text;
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('admin','secretary') then
    raise exception using errcode = '42501', message = 'Only an active Admin or Secretary can transfer a homeowner.';
  end if;
  if p_previous_property_id is null or p_expected_homeowner_id is null then
    raise exception using errcode = '22023', message = 'Reload the homeowner before transferring.';
  end if;
  select homeowner_id, homeowner_status into current_owner, current_status
  from public.properties where id = p_previous_property_id for update;
  if not found or current_owner is distinct from p_expected_homeowner_id or current_status is distinct from 'active' then
    raise exception using errcode = '40001', message = 'The homeowner changed since you opened the transfer. Reload and review the account.';
  end if;
  return query select t.new_property_id, t.transferred_balance
    from public.transfer_homeowner(p_previous_property_id,p_new_homeowner_name,p_effective_date,p_note) t;
end;
$$;

create or replace function public.transfer_homeowner_to_existing_guarded(
  p_previous_property_id bigint,
  p_expected_homeowner_id uuid,
  p_target_property_id bigint,
  p_expected_target_homeowner_id uuid,
  p_effective_date date,
  p_note text default null
)
returns table(new_property_id bigint, transferred_balance numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  source_owner uuid;
  source_status text;
  target_owner uuid;
  target_status text;
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('admin','secretary') then
    raise exception using errcode = '42501', message = 'Only an active Admin or Secretary can transfer a lot.';
  end if;
  if p_previous_property_id is null or p_target_property_id is null or
     p_previous_property_id = p_target_property_id or
     p_expected_homeowner_id is null or p_expected_target_homeowner_id is null then
    raise exception using errcode = '22023', message = 'Reload both homeowners before transferring.';
  end if;
  -- Lock both rows in deterministic ID order, like the existing transfer RPC.
  perform 1 from public.properties
    where id in (p_previous_property_id, p_target_property_id)
    order by id for update;
  select homeowner_id, homeowner_status into source_owner, source_status
    from public.properties where id = p_previous_property_id;
  if not found or source_owner is distinct from p_expected_homeowner_id or source_status is distinct from 'active' then
    raise exception using errcode = '40001', message = 'The source homeowner changed. Reload before transferring.';
  end if;
  select homeowner_id, homeowner_status into target_owner, target_status
    from public.properties where id = p_target_property_id;
  if not found or target_owner is distinct from p_expected_target_homeowner_id or target_status is distinct from 'active' then
    raise exception using errcode = '40001', message = 'The destination homeowner changed. Reload before transferring.';
  end if;
  return query select t.new_property_id, t.transferred_balance
    from public.transfer_homeowner_to_existing(p_previous_property_id,p_target_property_id,p_effective_date,p_note) t;
end;
$$;

revoke all on function public.transfer_homeowner_guarded(bigint,uuid,text,date,text) from public,anon,authenticated;
revoke all on function public.transfer_homeowner_to_existing_guarded(bigint,uuid,bigint,uuid,date,text) from public,anon,authenticated;
grant execute on function public.transfer_homeowner_guarded(bigint,uuid,text,date,text) to authenticated;
grant execute on function public.transfer_homeowner_to_existing_guarded(bigint,uuid,bigint,uuid,date,text) to authenticated;
notify pgrst, 'reload schema';
commit;
