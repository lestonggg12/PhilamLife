-- Add a person identity above the existing per-lot accounts. No financial FK changes.
-- Verified live: properties_one_active_homeowner_per_lot_idx is UNIQUE on
-- (lower(btrim(block)), lot_number) WHERE coalesce(homeowner_status, 'active') = 'active'.
begin;

-- Keep the backfill and its invariants consistent with concurrent writes.
lock table public.properties in share row exclusive mode;
lock table public.payments, public.property_charges, public.balance_entries,
  public.late_payment_penalties in share mode;

create temporary table multilot_before (table_name text primary key, fingerprint text)
  on commit drop;
do $$
declare
  tbl text;
  fingerprint text;
begin
  foreach tbl in array array['properties', 'payments', 'property_charges',
    'balance_entries', 'late_payment_penalties'] loop
    execute format(
      'select count(*)::text || '':'' || md5(coalesce(string_agg((to_jsonb(t) - ''homeowner_id'')::text, E''\n'' order by id), '''')) from public.%I t', tbl)
      into fingerprint;
    insert into multilot_before values (tbl, fingerprint);
  end loop;
  if exists (select 1 from public.properties where lot_number <= 0) then
    raise exception 'Existing lot numbers must be greater than zero before this migration can run. No records were changed.';
  end if;
end;
$$;

create table public.homeowners (
  id uuid primary key default gen_random_uuid(),
  -- Preserve existing nullable legacy names without inventing an identity/name.
  full_name text,
  contact_phone text,
  contact_email text,
  contact_updated_at timestamptz
);
alter table public.homeowners enable row level security;
revoke all on public.homeowners from public, anon, authenticated;
grant select on public.homeowners to authenticated;
grant update (full_name, contact_phone, contact_email, contact_updated_at)
  on public.homeowners to authenticated;
grant all on public.homeowners to service_role;
create policy "Staff can view homeowners" on public.homeowners
  for select to authenticated
  using ((select public.current_user_role()) in ('admin', 'secretary', 'treasurer'));
create policy "Admin and Secretary can update homeowners" on public.homeowners
  for update to authenticated
  using ((select public.current_user_role()) in ('admin', 'secretary'))
  with check ((select public.current_user_role()) in ('admin', 'secretary'));

alter table public.properties add column homeowner_id uuid
  references public.homeowners(id) on delete restrict;
create index properties_homeowner_id_idx on public.properties(homeowner_id);
alter table public.properties add constraint properties_lot_number_positive
  check (lot_number > 0);

-- Preserve the inspected existing index. This also creates the same rule on a
-- local database whose earlier migrations have not created it yet.
create unique index if not exists properties_one_active_homeowner_per_lot_idx
  on public.properties (lower(btrim(block)), lot_number)
  where coalesce(homeowner_status, 'active') = 'active';

-- Deliberately one new UUID per lot; equal names are NEVER merged.
do $$
declare
  lot record;
  person_id uuid;
begin
  for lot in select id, homeowner_name, contact_phone, contact_email,
    contact_updated_at from public.properties order by id loop
    insert into public.homeowners(full_name, contact_phone, contact_email, contact_updated_at)
      values (lot.homeowner_name, lot.contact_phone, lot.contact_email, lot.contact_updated_at)
      returning id into person_id;
    update public.properties set homeowner_id = person_id where id = lot.id;
  end loop;
end;
$$;

-- Trigger-only functions need elevated access to synchronize siblings under
-- the existing properties RLS. They are not callable RPCs (EXECUTE revoked).
create function public.multilot_assign_homeowner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  person public.homeowners%rowtype;
begin
  if new.homeowner_id is null then
    insert into public.homeowners(full_name, contact_phone, contact_email, contact_updated_at)
      values (new.homeowner_name, new.contact_phone, new.contact_email, new.contact_updated_at)
      returning id into new.homeowner_id;
  elsif tg_op = 'INSERT' or new.homeowner_id is distinct from old.homeowner_id then
    select * into person from public.homeowners where id = new.homeowner_id for update;
    if not found then
      raise foreign_key_violation using message = 'Homeowner not found.';
    end if;
    new.homeowner_name := person.full_name;
    new.contact_phone := person.contact_phone;
    new.contact_email := person.contact_email;
    new.contact_updated_at := person.contact_updated_at;
  end if;
  return new;
end;
$$;

create function public.multilot_property_contact_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.homeowners set
    full_name = new.homeowner_name,
    contact_phone = new.contact_phone,
    contact_email = new.contact_email,
    contact_updated_at = new.contact_updated_at
  where id = new.homeowner_id
    and (full_name, contact_phone, contact_email, contact_updated_at) is distinct from
        (new.homeowner_name, new.contact_phone, new.contact_email, new.contact_updated_at);
  return new;
end;
$$;

create function public.multilot_homeowner_contact_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Update only identity/contact fields. No balances, statuses, dues or history.
  -- The distinct test stops recursion when the property trigger writes back.
  update public.properties set
    homeowner_name = new.full_name,
    contact_phone = new.contact_phone,
    contact_email = new.contact_email,
    contact_updated_at = new.contact_updated_at
  where homeowner_id = new.id
    and (homeowner_name, contact_phone, contact_email, contact_updated_at) is distinct from
        (new.full_name, new.contact_phone, new.contact_email, new.contact_updated_at);
  return new;
end;
$$;

revoke all on function public.multilot_assign_homeowner() from public, anon, authenticated;
revoke all on function public.multilot_property_contact_changed() from public, anon, authenticated;
revoke all on function public.multilot_homeowner_contact_changed() from public, anon, authenticated;

create trigger multilot_assign_homeowner
  before insert or update of homeowner_id on public.properties
  for each row execute function public.multilot_assign_homeowner();
create trigger multilot_property_contact_changed
  after update of homeowner_name, contact_phone, contact_email, contact_updated_at on public.properties
  for each row execute function public.multilot_property_contact_changed();
create trigger multilot_homeowner_contact_changed
  after update of full_name, contact_phone, contact_email, contact_updated_at on public.homeowners
  for each row execute function public.multilot_homeowner_contact_changed();

-- Verify every original value, including all monetary values, not just totals.
do $$
declare
  original record;
  fingerprint text;
begin
  for original in select * from multilot_before loop
    execute format(
      'select count(*)::text || '':'' || md5(coalesce(string_agg((to_jsonb(t) - ''homeowner_id'')::text, E''\n'' order by id), '''')) from public.%I t', original.table_name)
      into fingerprint;
    if fingerprint is distinct from original.fingerprint then
      raise exception 'Migration changed existing % data; rolling back.', original.table_name;
    end if;
  end loop;
  if exists (select 1 from public.properties where homeowner_id is null)
     or (select count(*) from public.properties) <> (select count(*) from public.homeowners) then
    raise exception 'Backfill must create exactly one homeowner per existing lot.';
  end if;
end;
$$;
commit;
