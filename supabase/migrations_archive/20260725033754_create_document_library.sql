begin;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (
      length(btrim(title)) between 1 and 160
    ),
  category text not null
    check (
      category in (
        'Minutes',
        'Reports',
        'Legal',
        'Announcements',
        'Forms',
        'Other'
      )
    ),
  storage_path text not null unique
    check (storage_path like 'documents/%'),
  original_file_name text not null
    check (
      length(btrim(original_file_name)) between 1 and 255
    ),
  mime_type text not null
    check (length(btrim(mime_type)) > 0),
  file_size bigint not null
    check (file_size > 0 and file_size <= 10485760),
  uploaded_by uuid default auth.uid()
    references auth.users(id) on delete set null,
  uploaded_by_name text not null
    check (
      length(btrim(uploaded_by_name)) between 1 and 160
    ),
  created_at timestamptz not null default now()
);

comment on table public.documents is
  'Metadata for private HOA files stored in the hoa-documents Storage bucket.';
comment on column public.documents.storage_path is
  'Unique object path inside the private hoa-documents Storage bucket.';

create index documents_uploaded_by_idx
  on public.documents (uploaded_by);

alter table public.documents enable row level security;

revoke all on table public.documents from anon;
grant select, insert, delete on table public.documents to authenticated;

create policy "Admin and Secretary can view documents"
on public.documents
for select
to authenticated
using (
  (select public.current_user_role()) in ('admin', 'secretary')
);

create policy "Secretary can upload documents"
on public.documents
for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (select public.current_user_role()) = 'secretary'
);

create policy "Admin and Secretary can delete documents"
on public.documents
for delete
to authenticated
using (
  (select public.current_user_role()) in ('admin', 'secretary')
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'hoa-documents',
  'hoa-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Admin and Secretary can read HOA document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hoa-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (select public.current_user_role()) in ('admin', 'secretary')
);

create policy "Secretary can upload HOA document files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'hoa-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (select public.current_user_role()) = 'secretary'
);

create policy "Admin and Secretary can delete HOA document files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'hoa-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (select public.current_user_role()) in ('admin', 'secretary')
);

commit;
