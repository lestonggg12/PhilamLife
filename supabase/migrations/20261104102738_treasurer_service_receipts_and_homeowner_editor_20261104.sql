-- Treasurer service receipts and safe homeowner/profile editing.
-- Preserve existing restrictions on receipt voiding, transfers and balances.

alter policy "Secretary can record service transactions"
on public.service_transactions
rename to "Secretary and Treasurer can record service transactions";

alter policy "Secretary and Treasurer can record service transactions"
on public.service_transactions
with check (
  public.current_user_role() in ('secretary','treasurer')
  and recorded_by = auth.uid()
);

create or replace function public.next_service_receipt_number()
returns text
language plpgsql
security definer
set search_path='public','pg_temp'
as $fn$
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(),'')
        not in ('secretary','treasurer') then
    raise exception using
      errcode='42501',
      message='Only an active Secretary or Treasurer can allocate service receipt numbers.';
  end if;

  return 'SR-'
    || to_char(timezone('Asia/Manila',now()),'YYYY')
    || '-'
    || lpad(nextval('public.service_receipt_sequence')::text,6,'0');
end;
$fn$;

create policy "Treasurer can create homeowner records"
on public.properties
for insert to authenticated
with check (public.current_user_role()='treasurer');

create policy "Treasurer can edit homeowner details"
on public.properties
for update to authenticated
using (public.current_user_role()='treasurer')
with check (public.current_user_role()='treasurer');

create or replace function public.guard_treasurer_homeowner_details()
returns trigger
language plpgsql
security definer
set search_path=''
as $fn$
begin
  if auth.uid() is not null
     and public.current_user_role()='treasurer'
     and pg_trigger_depth()=1
     and (
       to_jsonb(new) -
       array['homeowner_name','block','lot_number','lot_size_sqm']
     ) is distinct from (
       to_jsonb(old) -
       array['homeowner_name','block','lot_number','lot_size_sqm']
     )
  then
    raise exception using
      errcode='42501',
      message='Treasurer may edit homeowner name, block, lot number, or lot size only. Transfers and financial changes require an Admin or Secretary.';
  end if;

  return new;
end;
$fn$;

create trigger a_guard_treasurer_homeowner_details
before update on public.properties
for each row
execute function public.guard_treasurer_homeowner_details();

create or replace function public.save_homeowner_contact(
  p_property_id bigint,
  p_expected_homeowner_id uuid,
  p_expected_phone text,
  p_expected_email text,
  p_expected_updated_at timestamp with time zone,
  p_phone text,
  p_email text
)
returns public.properties
language plpgsql
security definer
set search_path=''
as $fn$
declare
  person public.homeowners%rowtype;
  account public.properties%rowtype;
  clean_phone text :=
    nullif(regexp_replace(btrim(p_phone),'\s+',' ','g'),'');
  clean_email text := nullif(lower(btrim(p_email)),'');
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(),'')
        not in ('admin','secretary','treasurer') then
    raise exception using
      errcode='42501',
      message='Only active Admin, Secretary, or Treasurer accounts can update contact details.';
  end if;

  if p_expected_homeowner_id is null then
    raise exception using
      errcode='40001',
      message='Reload this contact before saving.';
  end if;

  if length(clean_phone)>30
     or (
       clean_email is not null
       and clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     ) then
    raise exception using
      errcode='22023',
      message='Enter a valid email and a phone number of at most 30 characters.';
  end if;

  perform 1
  from public.properties
  where homeowner_id=p_expected_homeowner_id
  order by id
  for update;

  select * into account
  from public.properties
  where id=p_property_id;

  if not found
     or account.homeowner_id is distinct from p_expected_homeowner_id then
    raise exception using
      errcode='40001',
      message='The homeowner account changed. Reload before saving.';
  end if;

  select * into person
  from public.homeowners
  where id=p_expected_homeowner_id
  for update;

  if not found
     or (
       person.contact_phone,
       person.contact_email,
       person.contact_updated_at
     ) is distinct from (
       p_expected_phone,
       p_expected_email,
       p_expected_updated_at
     ) then
    raise exception using
      errcode='40001',
      message='Contact details changed since this form was opened. Reload before saving.';
  end if;

  update public.homeowners
  set contact_phone=clean_phone,
      contact_email=clean_email
  where id=person.id
    and (contact_phone,contact_email)
        is distinct from (clean_phone,clean_email);

  select * into account
  from public.properties
  where id=p_property_id;

  return account;
end;
$fn$;

notify pgrst,'reload schema';