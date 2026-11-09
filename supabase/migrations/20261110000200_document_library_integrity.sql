begin;
set local lock_timeout = '5s';

-- Report history contains metadata only, without a file or a download path.
-- The path hash prevents a stale retry from recreating a retired object key.
create table if not exists public.document_upload_events (
  id uuid primary key,
  title text not null,
  category text not null,
  created_at timestamptz not null,
  path_hash text not null unique
);
create index if not exists document_upload_events_created_at_idx on public.document_upload_events(created_at);
alter table public.document_upload_events enable row level security;
revoke all on public.document_upload_events from public, anon, authenticated;
grant select on public.document_upload_events to authenticated;
drop policy if exists document_upload_events_staff_read on public.document_upload_events;
create policy document_upload_events_staff_read on public.document_upload_events
  for select to authenticated using ((select public.current_user_role()) in ('admin', 'secretary', 'treasurer'));

-- Existing records are preserved. An old entry remains in the report when its
-- file is first deleted under this migration. No deleted record is backfilled.
create view public.document_upload_report with (security_invoker = true) as
  select id,title,category,created_at from public.document_upload_events
  union all
  select d.id,d.title,d.category,d.created_at from public.documents d
  where not exists (select 1 from public.document_upload_events e where e.id=d.id);
revoke all on public.document_upload_report from public, anon, authenticated;
grant select on public.document_upload_report to authenticated;

create function public.verify_document_upload()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  object_metadata jsonb;
  display_name text;
begin
  if actor is null or public.current_user_role() is distinct from 'secretary' then
    raise exception using errcode = '42501', message = 'Only an active Secretary can register uploads.';
  end if;
  select o.metadata into object_metadata
    from storage.objects o
    where o.bucket_id='hoa-documents' and o.name=new.storage_path and o.owner_id=actor::text;
  if not found or object_metadata is null then
    raise exception using errcode = '23514', message = 'The uploaded file could not be verified for this account. Retry the same upload.';
  end if;
  if (object_metadata->>'size') is distinct from new.file_size::text
    or lower(split_part(object_metadata->>'mimetype', ';', 1)) is distinct from new.mime_type then
    raise exception using errcode = '23514', message = 'The recorded file type or size differs from Storage.';
  end if;
  select coalesce(nullif(btrim(full_name),''),nullif(btrim(email),''),'Secretary')
    into display_name from public.profiles where id=actor;
  new.uploaded_by := actor;
  new.uploaded_by_name := left(coalesce(display_name,'Secretary'),160);
  new.created_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function public.verify_document_upload() from public, anon, authenticated;
create trigger verify_document_upload before insert on public.documents
  for each row execute function public.verify_document_upload();

create function public.record_document_upload_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  doc public.documents%rowtype;
begin
  if tg_op='DELETE' then doc := old; else doc := new; end if;
  insert into public.document_upload_events(id,title,category,created_at,path_hash)
  values(doc.id,doc.title,doc.category,doc.created_at,encode(sha256(convert_to(doc.storage_path,'UTF8')),'hex'))
  on conflict (id) do nothing;
  return doc;
end;
$$;
revoke all on function public.record_document_upload_event() from public, anon, authenticated;
create trigger record_document_upload_event after insert on public.documents
  for each row execute function public.record_document_upload_event();

create trigger retain_document_upload_event before delete on public.documents
  for each row execute function public.record_document_upload_event();

-- The browser calls this only after attempting to store the bytes. Older
-- deployments without this endpoint cannot accidentally register a retry.
create function public.register_document_upload(
  p_title text, p_category text, p_storage_path text, p_original_file_name text,
  p_mime_type text, p_file_size bigint
)
returns setof public.documents language plpgsql security invoker set search_path = '' as $$
declare doc public.documents%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'secretary' then
    raise exception using errcode = '42501', message = 'Only an active Secretary can register uploads.';
  end if;
  if not exists (select 1 from public.documents where storage_path=p_storage_path)
    and exists (select 1 from public.document_upload_events
      where path_hash=encode(sha256(convert_to(p_storage_path,'UTF8')),'hex')) then
    raise exception using errcode = 'PHD01', message = 'The previous entry was deleted. Upload again to create a new entry.';
  end if;
  insert into public.documents(title,category,storage_path,original_file_name,mime_type,file_size)
    values(p_title,p_category,p_storage_path,p_original_file_name,p_mime_type,p_file_size)
    returning * into doc;
  return next doc;
end;
$$;
revoke all on function public.register_document_upload(text,text,text,text,text,bigint) from public, anon;
grant execute on function public.register_document_upload(text,text,text,text,text,bigint) to authenticated;

-- Only the deletion operation may select a pending object. Regular reads
-- require an available document for every staff role.
alter policy "Admin, Secretary and Treasurer can read HOA document files" on storage.objects using (
  bucket_id='hoa-documents' and (storage.foldername(name))[1]='documents'
  and (select public.current_user_role()) in ('admin','secretary','treasurer')
  and exists (
    select 1 from public.documents d where d.storage_path=objects.name
    and (d.deletion_requested_at is null or (
      (select public.current_user_role()) in ('admin','secretary')
      and storage.allow_any_operation(array['object.delete','object.delete_many'])
    ))
  )
);

-- Restrict removal to a marked row. This prevents an unregistered object from
-- being removed in a separate request while metadata registration is underway.
alter policy "Admin and Secretary can delete HOA document files" on storage.objects using (
  bucket_id='hoa-documents' and (storage.foldername(name))[1]='documents'
  and (select public.current_user_role()) in ('admin','secretary')
  and exists (select 1 from public.documents d where d.storage_path=objects.name and d.deletion_requested_at is not null)
);

alter policy "Secretary can upload HOA document files" on storage.objects with check (
  bucket_id='hoa-documents' and (storage.foldername(name))[1]='documents'
  and (select public.current_user_role())='secretary'
  and not exists (select 1 from public.documents d where d.storage_path=objects.name)
  and not exists (
    select 1 from public.document_upload_events e
    where e.path_hash=encode(sha256(convert_to(objects.name,'UTF8')),'hex')
  )
);

commit;
