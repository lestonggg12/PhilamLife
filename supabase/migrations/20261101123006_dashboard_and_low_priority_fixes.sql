-- Low-priority audit fixes F08, F09, F10. No existing records are rewritten.
-- Apply this migration BEFORE the matching HomeownersPage frontend change.
begin;

-- Unused browser maintenance surfaces. Existing data and trusted maintenance
-- privileges remain. The yearly defaults UI writes system_settings, not this table.
revoke insert, update, delete on public.late_penalty_year_rates from public, anon, authenticated;
-- Clear any per-column grants too, so a later grant cannot accidentally retain writes.
do $$
declare col record;
begin
  for col in select attname from pg_attribute
    where attrelid = 'public.late_penalty_year_rates'::regclass
      and attnum > 0 and not attisdropped
  loop
    execute format('revoke insert (%I), update (%I) on public.late_penalty_year_rates from public, anon, authenticated', col.attname, col.attname);
  end loop;
end;
$$;

-- Restore is an owner-only maintenance operation with no current UI.
revoke execute on function public.restore_voided_charge(uuid) from public, anon, authenticated;
-- This function is a COLUMN DEFAULT on service_transactions, so authenticated
-- needs EXECUTE for normal Secretary inserts. Restrict by application role
-- inside the function rather than breaking its default-expression dependency.
create or replace function public.next_service_receipt_number()
returns text language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') <> 'secretary' then
    raise exception using errcode = '42501',
      message = 'Only an active Secretary can allocate service receipt numbers.';
  end if;
  return 'SR-' || to_char(timezone('Asia/Manila', now()), 'YYYY') || '-'
    || lpad(nextval('public.service_receipt_sequence')::text, 6, '0');
end;
$$;
revoke execute on function public.next_service_receipt_number() from public, anon;
grant execute on function public.next_service_receipt_number() to authenticated;

-- Transfers still require the existing active Admin/Secretary guard.
revoke execute on function public.transfer_homeowner(bigint, text, date, text) from public, anon;
grant execute on function public.transfer_homeowner(bigint, text, date, text) to authenticated;
-- Trigger execution continues; this helper is never a browser RPC.
revoke execute on function public.apply_homeowner_balance_transfer() from public, anon, authenticated;

-- A real relationship makes rename/cascade and delete/reference checks atomic,
-- even for direct API calls or simultaneous property writes. Historical records
-- are included. Validation fails without rewriting data if an orphan exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_block_name_fkey'
  ) then
    alter table public.properties
      add constraint properties_block_name_fkey foreign key (block)
      references public.blocks(name) on update cascade on delete restrict;
  end if;
end;
$$;

-- Abort if inherited privileges or a conflicting existing constraint would
-- make the security/atomicity guarantee false.
do $$
declare relation_ok boolean;
begin
  if has_table_privilege('authenticated', 'public.late_penalty_year_rates', 'INSERT')
     or has_table_privilege('authenticated', 'public.late_penalty_year_rates', 'UPDATE')
     or has_table_privilege('authenticated', 'public.late_penalty_year_rates', 'DELETE')
     or has_any_column_privilege('authenticated', 'public.late_penalty_year_rates', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.late_penalty_year_rates', 'UPDATE')
     or has_function_privilege('authenticated', 'public.restore_voided_charge(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.next_service_receipt_number()', 'EXECUTE')
     or has_function_privilege('anon', 'public.transfer_homeowner(bigint,text,date,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.apply_homeowner_balance_transfer()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.apply_homeowner_balance_transfer()', 'EXECUTE') then
    raise exception 'Unexpected inherited privileges remain; migration rolled back.';
  end if;

  select c.contype = 'f' and c.confrelid = 'public.blocks'::regclass
    and c.confupdtype = 'c' and c.confdeltype = 'r' and c.convalidated
    and c.conkey = array[(select attnum from pg_attribute where attrelid='public.properties'::regclass and attname='block')]::smallint[]
    and c.confkey = array[(select attnum from pg_attribute where attrelid='public.blocks'::regclass and attname='name')]::smallint[]
    into relation_ok
  from pg_constraint c where c.conrelid='public.properties'::regclass
    and c.conname='properties_block_name_fkey';
  if relation_ok is distinct from true then
    raise exception 'Unexpected block relationship; migration rolled back.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
