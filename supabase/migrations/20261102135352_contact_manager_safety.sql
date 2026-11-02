-- Contact Manager: versioned person contacts, guarded Move, finite dates.
-- No historical contacts, balances, receipts or staff profiles are rewritten.
begin;
set local lock_timeout='5s';

do $$begin
 if not exists(select 1 from pg_trigger where tgrelid='public.properties'::regclass
   and tgname='audit_property_management' and tgenabled='O')
   or to_regprocedure('public.write_required_balance_audit(text,text)') is null then
  raise exception 'Install and verify the authoritative Activity Log migration first.';
 end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.properties'::regclass and tgname='multilot_property_contact_changed' and tgenabled='O')
   or not exists(select 1 from pg_trigger where tgrelid='public.homeowners'::regclass and tgname='multilot_homeowner_contact_changed' and tgenabled='O') then
  raise exception 'The shared homeowner contact synchronization triggers must be enabled.';
 end if;
 if has_table_privilege('authenticated','public.properties','UPDATE')
   or has_table_privilege('authenticated','public.homeowners','UPDATE') then
  raise exception 'Unexpected broad UPDATE grant. Review property/homeowner grants before installing.';
 end if;
end$$;

do $$begin
 if not exists(select 1 from pg_constraint where conrelid='public.properties'::regclass and conname='properties_supported_status_date') then
  alter table public.properties add constraint properties_supported_status_date check(
   status_effective_date is null or (isfinite(status_effective_date)
    and status_effective_date between date '0001-01-01' and date '9999-12-31'));
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.homeowner_balance_transfers'::regclass and conname='transfers_supported_effective_date') then
  alter table public.homeowner_balance_transfers add constraint transfers_supported_effective_date check(
   effective_date is not null and isfinite(effective_date)
    and effective_date between date '0001-01-01' and date '9999-12-31');
 end if;
end$$;

-- A contact version is server-generated and advances even within one transaction.
create or replace function public.stamp_homeowner_contact()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.contact_phone,new.contact_email) is distinct from (old.contact_phone,old.contact_email) then
  new.contact_updated_at:=greatest(clock_timestamp(),coalesce(old.contact_updated_at,'-infinity'::timestamptz)+interval '1 microsecond');
 else
  new.contact_updated_at:=old.contact_updated_at;
 end if;
 return new;
end;
$$;
revoke all on function public.stamp_homeowner_contact() from public,anon,authenticated;
create or replace trigger stamp_homeowner_contact before update on public.homeowners
 for each row execute function public.stamp_homeowner_contact();

-- A name-only edit must never write a stale contact snapshot back to the person.
-- Shared contact propagation still uses the existing homeowner->property trigger.
create or replace function public.multilot_property_contact_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.homeowner_name is distinct from old.homeowner_name then
  update public.homeowners set full_name=new.homeowner_name
   where id=new.homeowner_id and full_name is distinct from new.homeowner_name;
 end if;
 if (new.contact_phone,new.contact_email) is distinct from (old.contact_phone,old.contact_email) then
  update public.homeowners set contact_phone=new.contact_phone,contact_email=new.contact_email
   where id=new.homeowner_id and (contact_phone,contact_email) is distinct from (new.contact_phone,new.contact_email);
 end if;
 return new;
end;
$$;
revoke all on function public.multilot_property_contact_changed() from public,anon,authenticated;

create or replace function public.save_homeowner_contact(
 p_property_id bigint,p_expected_homeowner_id uuid,p_expected_phone text,
 p_expected_email text,p_expected_updated_at timestamptz,p_phone text,p_email text
) returns public.properties language plpgsql security definer set search_path='' as $$
declare person public.homeowners%rowtype; account public.properties%rowtype;
 clean_phone text:=nullif(regexp_replace(btrim(p_phone),'\s+',' ','g'),'');
 clean_email text:=nullif(lower(btrim(p_email)),'');
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'') not in ('admin','secretary') then
  raise exception using errcode='42501',message='Only an active Admin or Secretary can update contact details.';
 end if;
 if p_expected_homeowner_id is null then
  raise exception using errcode='40001',message='Reload this contact before saving.';
 end if;
 if length(clean_phone)>30 or (clean_email is not null and clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
  raise exception using errcode='22023',message='Enter a valid email and a phone number of at most 30 characters.';
 end if;
 -- Same-person saves lock linked property accounts in one deterministic order.
 perform 1 from public.properties where homeowner_id=p_expected_homeowner_id order by id for update;
 select * into account from public.properties where id=p_property_id;
 if not found or account.homeowner_id is distinct from p_expected_homeowner_id then
  raise exception using errcode='40001',message='The homeowner account changed. Reload before saving.';
 end if;
 select * into person from public.homeowners where id=p_expected_homeowner_id for update;
 if not found or (person.contact_phone,person.contact_email,person.contact_updated_at)
    is distinct from (p_expected_phone,p_expected_email,p_expected_updated_at) then
  raise exception using errcode='40001',message='Contact details changed since this form was opened. Reload before saving.';
 end if;
 update public.homeowners set contact_phone=clean_phone,contact_email=clean_email
  where id=person.id and (contact_phone,contact_email) is distinct from (clean_phone,clean_email);
 select * into account from public.properties where id=p_property_id;
 return account;
end;
$$;
revoke all on function public.save_homeowner_contact(bigint,uuid,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.save_homeowner_contact(bigint,uuid,text,text,timestamptz,text,text) to authenticated;

create or replace function public.guard_homeowner_status()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.status_effective_date>public.hoa_manila_today() then
   raise exception using errcode='22023',message='Choose an effective date of today or earlier.';
  end if;
  return new; -- Finiteness and supported year bounds are enforced by the CHECK.
 end if;
 if (new.homeowner_status,new.status_effective_date,new.status_reason)
   is distinct from (old.homeowner_status,old.status_effective_date,old.status_reason) then
  if old.homeowner_status is distinct from 'active' or new.homeowner_status not in ('moved','transferred')
    or exists(select 1 from public.homeowner_balance_transfers where previous_property_id=old.id) then
   raise exception using errcode='40001',message='This account already changed status. Reload before continuing.';
  end if;
  if new.status_effective_date is null or not isfinite(new.status_effective_date)
    or new.status_effective_date not between date '0001-01-01' and date '9999-12-31'
    or new.status_effective_date>public.hoa_manila_today() then
   raise exception using errcode='22023',message='Choose a valid effective date of today or earlier.';
  end if;
  new.status_updated_at:=greatest(clock_timestamp(),coalesce(old.status_updated_at,'-infinity'::timestamptz)+interval '1 microsecond');
 end if;
 return new;
end;
$$;
revoke all on function public.guard_homeowner_status() from public,anon,authenticated;
create or replace trigger guard_homeowner_status before insert or update on public.properties
 for each row execute function public.guard_homeowner_status();

create or replace function public.move_homeowner(
 p_property_id bigint,p_expected_homeowner_id uuid,p_expected_updated_at timestamptz,
 p_effective_date date,p_note text default null
) returns public.properties language plpgsql security definer set search_path='' as $$
declare account public.properties%rowtype;
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'') not in ('admin','secretary') then
  raise exception using errcode='42501',message='Only an active Admin or Secretary can move a homeowner.';
 end if;
 if p_effective_date is null or not isfinite(p_effective_date)
  or p_effective_date not between date '0001-01-01' and date '9999-12-31'
  or p_effective_date>public.hoa_manila_today() then
  raise exception using errcode='22023',message='Choose a valid effective date of today or earlier.';
 end if;
 if length(p_note)>500 then raise exception using errcode='22023',message='The note must be 500 characters or fewer.'; end if;
 select * into account from public.properties where id=p_property_id for update;
 if not found or p_expected_homeowner_id is null or account.homeowner_id is distinct from p_expected_homeowner_id
  or account.homeowner_status is distinct from 'active'
  or account.status_updated_at is distinct from p_expected_updated_at then
  raise exception using errcode='40001',message='This account changed since the form was opened. Reload before moving it.';
 end if;
 update public.properties set homeowner_status='moved',status_effective_date=p_effective_date,
  status_reason=nullif(btrim(p_note),'') where id=account.id returning * into account;
 return account;
end;
$$;
revoke all on function public.move_homeowner(bigint,uuid,timestamptz,date,text) from public,anon,authenticated;
grant execute on function public.move_homeowner(bigint,uuid,timestamptz,date,text) to authenticated;

-- Close the unversioned browser paths; other homeowner/lot edits keep their grants.
revoke update(contact_phone,contact_email,contact_updated_at) on public.properties from public,anon,authenticated;
revoke update(contact_phone,contact_email,contact_updated_at) on public.homeowners from public,anon,authenticated;
revoke update(homeowner_status,status_effective_date,status_reason,status_updated_at) on public.properties from public,anon,authenticated;

-- Transfer definitions follow below; their existing signatures and signed-money
-- implementation are retained, with early finite-date validation added.

CREATE OR REPLACE FUNCTION public.transfer_homeowner(p_previous_property_id bigint, p_new_homeowner_name text, p_effective_date date, p_note text DEFAULT NULL::text)
 RETURNS TABLE(new_property_id bigint, transferred_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  old_property public.properties%rowtype;
  created_property_id bigint;
  transfer_amount numeric(12,2);
  transfer_id uuid;
  clean_name text;
  clean_note text;
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(), '')
        not in ('admin', 'secretary') then
    raise exception 'Only an Admin or Secretary can transfer a homeowner.';
  end if;

  clean_name := nullif(btrim(p_new_homeowner_name), '');
  clean_note := nullif(btrim(p_note), '');

  if clean_name is null or length(clean_name) > 120 then
    raise exception 'Enter a valid new homeowner name (maximum 120 characters).';
  end if;

  if p_effective_date is null or not isfinite(p_effective_date)
     or p_effective_date not between date '0001-01-01' and date '9999-12-31'
     or p_effective_date > public.hoa_manila_today() then
    raise exception 'The effective date must be today or earlier.';
  end if;

  select *
    into old_property
  from public.properties
  where id = p_previous_property_id
  for update;

  if not found then
    raise exception 'The previous homeowner account was not found.';
  end if;

  if old_property.homeowner_status <> 'active' then
    raise exception 'Only an active homeowner can be transferred.';
  end if;

  if exists (
    select 1
    from public.homeowner_balance_transfers
    where previous_property_id = old_property.id
  ) then
    raise exception 'This account already has a recorded balance transfer.';
  end if;

  transfer_amount := coalesce(old_property.current_balance, 0);

  -- Retire the previous owner first so the lot's active-owner
  -- uniqueness constraint allows the new account to be created.
  update public.properties
  set homeowner_status = 'transferred',
      status_effective_date = p_effective_date,
      status_reason = clean_note,
      status_updated_at = now()
  where id = old_property.id;

  -- Create a distinct account for the new owner and same property.
  insert into public.properties (
    block,
    lot_number,
    homeowner_name,
    homeowner_status,
    lot_size_sqm
  )
  values (
    old_property.block,
    old_property.lot_number,
    clean_name,
    'active',
    old_property.lot_size_sqm
  )
  returning id into created_property_id;

  -- The audit row's trigger moves the signed balance and creates
  -- matching ledger adjustments for both accounts.
  insert into public.homeowner_balance_transfers (
    previous_property_id,
    new_property_id,
    transferred_balance,
    effective_date,
    note,
    created_by
  )
  values (
    old_property.id,
    created_property_id,
    transfer_amount,
    p_effective_date,
    clean_note,
    auth.uid()
  )
  returning id into transfer_id;

  insert into public.activity_log (user_id, action, target)
  values (
    auth.uid(),
    'Homeowner Transferred',
    old_property.homeowner_name || ' -> ' || clean_name
      || ' — ' || old_property.block || ', Lot '
      || old_property.lot_number
      || '; Balance: ' || transfer_amount
      || '; Effective: ' || p_effective_date
      || '; Transfer ID: ' || transfer_id
  );

  return query
  select created_property_id, transfer_amount;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_homeowner_to_existing(p_previous_property_id bigint, p_target_property_id bigint, p_effective_date date, p_note text DEFAULT NULL::text)
 RETURNS TABLE(new_property_id bigint, transferred_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if p_effective_date is null or not isfinite(p_effective_date)
     or p_effective_date not between date '0001-01-01' and date '9999-12-31'
     or p_effective_date > public.hoa_manila_today() then
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
$function$
;

revoke all on function public.transfer_homeowner(bigint,text,date,text) from public,anon;
revoke all on function public.transfer_homeowner_to_existing(bigint,bigint,date,text) from public,anon;
grant execute on function public.transfer_homeowner(bigint,text,date,text) to authenticated;
grant execute on function public.transfer_homeowner_to_existing(bigint,bigint,date,text) to authenticated;
notify pgrst,'reload schema';
commit;
