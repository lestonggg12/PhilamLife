-- Restrict browser writes to the property fields used by existing management UI.
-- No records, balances, role assignments, RLS policies or finance functions change.
begin;

-- Table privileges override column restrictions, so remove the broad grants first.
revoke insert, update on table public.properties from public, anon, authenticated;

-- Clear any existing column write grants before installing an explicit allowlist.
revoke insert (
  id, block, lot_number, homeowner_name, created_at, contact_phone, contact_email,
  contact_updated_at, homeowner_status, status_effective_date, status_reason,
  status_updated_at, current_balance, opening_balance, opening_balance_as_of,
  opening_balance_note, lot_size_sqm, homeowner_id
), update (
  id, block, lot_number, homeowner_name, created_at, contact_phone, contact_email,
  contact_updated_at, homeowner_status, status_effective_date, status_reason,
  status_updated_at, current_balance, opening_balance, opening_balance_as_of,
  opening_balance_note, lot_size_sqm, homeowner_id
) on table public.properties from public, anon, authenticated;

grant insert (
  block, lot_number, homeowner_name, contact_phone, contact_email,
  contact_updated_at, homeowner_status, status_effective_date, status_reason,
  status_updated_at, lot_size_sqm, homeowner_id
), update (
  block, lot_number, homeowner_name, contact_phone, contact_email,
  contact_updated_at, homeowner_status, status_effective_date, status_reason,
  status_updated_at, lot_size_sqm, homeowner_id
) on table public.properties to authenticated;

-- SELECT (including SELECT * / RETURNING), DELETE, RLS and trusted server grants
-- remain as before. Existing SECURITY DEFINER finance/transfer paths write as
-- their owner and retain access to balances. Normal UI inserts use zero/null
-- financial defaults; Add Balance remains the way to enter a carried balance.
-- Fail the migration atomically if unexpected inherited grants keep a bypass.
do $$
declare protected_column text;
begin
  if has_table_privilege('authenticated', 'public.properties', 'INSERT')
     or has_table_privilege('authenticated', 'public.properties', 'UPDATE') then
    raise exception 'Broad property write privileges remain; review inherited role grants.';
  end if;
  foreach protected_column in array array[
    'current_balance', 'opening_balance', 'opening_balance_as_of',
    'opening_balance_note', 'id', 'created_at'
  ] loop
    if has_column_privilege('authenticated', 'public.properties', protected_column, 'INSERT')
       or has_column_privilege('authenticated', 'public.properties', protected_column, 'UPDATE') then
      raise exception 'Protected property column is still writable: %', protected_column;
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
