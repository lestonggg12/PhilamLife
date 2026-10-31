-- Add an atomic existing-owner transfer without changing the original RPC.
-- Existing receipts/charges remain attached to their original properties.id.
begin;
create function public.transfer_homeowner_to_existing(
  p_previous_property_id bigint,
  p_target_property_id bigint,
  p_effective_date date,
  p_note text default null
)
returns table(new_property_id bigint, transferred_balance numeric)
language plpgsql security definer set search_path = '' as $$
declare
  previous_property public.properties%rowtype;
  target_property public.properties%rowtype;
  target_name text;
  created_property_id bigint;
  transfer_amount numeric(12,2);
  transfer_id uuid;
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('admin', 'secretary') then
    raise exception 'Only an Admin or Secretary can transfer a lot.';
  end if;
  if p_previous_property_id is null or p_target_property_id is null
     or p_previous_property_id = p_target_property_id then
    raise exception 'Choose a different existing homeowner.';
  end if;
  -- Consistent lock order prevents either selected account changing mid-transfer.
  perform 1 from public.properties
    where id in (p_previous_property_id, p_target_property_id)
    order by id for update;
  select * into previous_property from public.properties where id = p_previous_property_id;
  if not found or previous_property.homeowner_status is distinct from 'active' then
    raise exception 'The lot to transfer must have an active homeowner. Refresh and try again.';
  end if;
  select * into target_property from public.properties where id = p_target_property_id;
  if not found or target_property.homeowner_status is distinct from 'active'
     or target_property.homeowner_id is null then
    raise exception 'The selected homeowner no longer has this active lot. Refresh and choose again.';
  end if;
  if target_property.homeowner_id = previous_property.homeowner_id then
    raise exception 'This lot already belongs to the selected homeowner.';
  end if;
  select full_name into target_name from public.homeowners where id = target_property.homeowner_id;
  if nullif(btrim(target_name), '') is null then
    raise exception 'The selected homeowner needs a name before receiving a lot.';
  end if;

  if p_effective_date is null or p_effective_date > public.hoa_manila_today() then
    raise exception 'The effective date must be today or earlier.';
  end if;
  if exists (select 1 from public.homeowner_balance_transfers
    where previous_property_id = previous_property.id) then
    raise exception 'This account already has a recorded balance transfer.';
  end if;
  transfer_amount := coalesce(previous_property.current_balance, 0);
  -- Retire only this lot account, freeing its unique active block/lot pair.
  update public.properties set homeowner_status = 'transferred',
    status_effective_date = p_effective_date, status_reason = nullif(btrim(p_note), ''),
    status_updated_at = now() where id = previous_property.id;
  -- Passing the exact person ID makes the existing synchronization trigger copy
  -- their current name/contact fields, without creating or merging people.
  insert into public.properties(homeowner_id, block, lot_number, homeowner_name,
    homeowner_status, lot_size_sqm)
  values(target_property.homeowner_id, previous_property.block,
    previous_property.lot_number, target_name, 'active', previous_property.lot_size_sqm)
  returning id into created_property_id;
  -- Reuse the existing audited transfer trigger for signed balance movement and
  -- matching ledger corrections. Do not edit or reassign existing money rows.
  insert into public.homeowner_balance_transfers(previous_property_id, new_property_id,
    transferred_balance, effective_date, note, created_by)
  values(previous_property.id, created_property_id, transfer_amount,
    p_effective_date, nullif(btrim(p_note), ''), auth.uid()) returning id into transfer_id;
  insert into public.activity_log(user_id, action, target)
  values(auth.uid(), 'Homeowner Transferred', previous_property.homeowner_name || ' -> ' || target_name
    || ' — ' || previous_property.block || ', Lot ' || previous_property.lot_number
    || '; Balance: ' || transfer_amount || '; Effective: ' || p_effective_date
    || '; Transfer ID: ' || transfer_id);
  return query select created_property_id, transfer_amount;

end;
$$;
revoke all on function public.transfer_homeowner_to_existing(bigint,bigint,date,text) from public, anon;
grant execute on function public.transfer_homeowner_to_existing(bigint,bigint,date,text) to authenticated;
comment on function public.transfer_homeowner_to_existing(bigint,bigint,date,text) is
  'Transfers one active lot to an explicitly selected existing homeowner; preserves per-lot history and the existing balance-transfer audit.';
commit;
