-- Preserve property-linked history and prevent stale Admin setting saves.
-- This migration changes no existing financial or historical records.
begin;
set local lock_timeout = '5s';

-- A normal homeowner deletion may only remove a genuinely empty property.
-- Inspect every current foreign key that points at properties instead of
-- maintaining a fragile application-side list of financial/operational tables.
create or replace function public.delete_empty_property_guarded(
  p_property_id bigint
)
returns table(deleted_property_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reference_row record;
  has_history boolean;
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('admin', 'secretary') then
    raise exception using errcode = '42501', message = 'Only an active Admin or Secretary can remove an empty homeowner account.';
  end if;
  if p_property_id is null then
    raise exception using errcode = '22023', message = 'Choose a homeowner account before deleting it.';
  end if;

  perform 1 from public.properties where id = p_property_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'The homeowner account no longer exists. Refresh before trying again.';
  end if;

  for reference_row in
    select c.conname, c.conkey, c.conrelid::regclass as relation_name, a.attname as column_name
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid = 'public.properties'::regclass
  loop
    if cardinality(reference_row.conkey) <> 1 then
      raise exception using
        errcode = 'P0001',
        message = format('Property deletion is blocked because foreign key %s needs an explicit history guard review.', reference_row.conname);
    end if;
    execute format(
      'select exists (select 1 from %s where %I = $1)',
      reference_row.relation_name,
      reference_row.column_name
    ) into has_history using p_property_id;
    if has_history then
      raise exception using
        errcode = '23503',
        message = format('Historical records exist in %s. Use Move / Transfer instead so this lot account and its history are preserved.', reference_row.relation_name),
        detail = format('Property %s is referenced by foreign key %s.', p_property_id, reference_row.conname);
    end if;
  end loop;

  delete from public.properties where id = p_property_id;
  if not found then
    raise exception using errcode = '40001', message = 'The homeowner account changed while deletion was being verified. Refresh and try again.';
  end if;
  deleted_property_id := p_property_id;
  return next;
end;
$$;

revoke all on function public.delete_empty_property_guarded(bigint) from public, anon, authenticated;
grant execute on function public.delete_empty_property_guarded(bigint) to authenticated;

-- Do not leave an RLS route that bypasses the authoritative history check.
drop policy if exists "Admin and Secretary can delete properties" on public.properties;

-- The general/security settings form carries a complete draft. A monotonic
-- revision rejects a stale draft rather than allowing one Admin tab to erase
-- another Admin's committed fields. Specialty settings still use their own
-- guarded RPCs; their updates also advance this revision.
alter table public.system_settings
  add column if not exists settings_revision bigint not null default 1;

update public.system_settings
   set settings_revision = greatest(coalesce(settings_revision, 1), 1)
 where settings_revision is null or settings_revision < 1;

create or replace function public.bump_system_settings_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'settings_revision')
       is distinct from
     (to_jsonb(old) - 'updated_at' - 'settings_revision') then
    new.settings_revision := old.settings_revision + 1;
  else
    new.settings_revision := old.settings_revision;
  end if;
  return new;
end;
$$;

drop trigger if exists bump_system_settings_revision on public.system_settings;
create trigger bump_system_settings_revision
  before update on public.system_settings
  for each row execute function public.bump_system_settings_revision();

create or replace function public.save_system_settings_guarded(
  p_expected_revision bigint,
  p_hoa_name text,
  p_address text,
  p_contact_email text,
  p_contact_phone text,
  p_billing_day integer,
  p_due_day integer,
  p_grace_period_days integer,
  p_require_strong_password boolean,
  p_session_timeout integer,
  p_currency text,
  p_timezone text,
  p_date_format text
)
returns public.system_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_settings public.system_settings%rowtype;
  saved public.system_settings%rowtype;
begin
  if auth.uid() is null or coalesce(public.current_user_role(), '') <> 'admin' then
    raise exception using errcode = '42501', message = 'Only an active Admin can change system settings.';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Settings revision is required. Refresh System Settings before saving.';
  end if;
  if nullif(btrim(p_hoa_name), '') is null or nullif(btrim(p_address), '') is null then
    raise exception using errcode = '22023', message = 'HOA name and address are required.';
  end if;
  if p_contact_email is not null and btrim(p_contact_email) <> ''
     and btrim(p_contact_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid contact email.';
  end if;
  if p_billing_day not between 1 and 31 or p_due_day not between p_billing_day and 31
     or p_grace_period_days < 0 or p_session_timeout not between 5 and 1440
     or p_currency <> 'PHP' or p_timezone <> 'Asia/Manila'
     or p_date_format not in ('MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD')
     or p_require_strong_password is null then
    raise exception using errcode = '22023', message = 'System settings contain invalid values.';
  end if;

  select * into current_settings from public.system_settings where id = 1 for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Settings record is missing.';
  end if;
  if current_settings.settings_revision is distinct from p_expected_revision then
    raise exception using errcode = '40001', message = 'Settings changed since this page was loaded. Refresh System Settings before saving.';
  end if;

  update public.system_settings
     set hoa_name = btrim(p_hoa_name),
         address = btrim(p_address),
         contact_email = nullif(btrim(p_contact_email), ''),
         contact_phone = nullif(btrim(p_contact_phone), ''),
         billing_day = p_billing_day,
         due_day = p_due_day,
         grace_period_days = p_grace_period_days,
         require_strong_password = p_require_strong_password,
         session_timeout = p_session_timeout,
         currency = p_currency,
         timezone = p_timezone,
         date_format = p_date_format,
         updated_by = auth.uid()
   where id = 1
   returning * into saved;
  return saved;
end;
$$;

revoke all on function public.save_system_settings_guarded(bigint,text,text,text,text,integer,integer,integer,boolean,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.save_system_settings_guarded(bigint,text,text,text,text,integer,integer,integer,boolean,integer,text,text,text) to authenticated;

-- Direct REST updates could otherwise bypass optimistic concurrency. Existing
-- specialty settings changes are already security-definer RPCs and continue to
-- work; the revision trigger above covers their successful updates as well.
drop policy if exists "Admin can update system settings" on public.system_settings;

notify pgrst, 'reload schema';
commit;