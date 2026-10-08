begin;

-- Allow Treasurer to view/download documents alongside Admin and Secretary.
-- Uploading remains Secretary-only (see "Secretary can upload documents" /
-- "Secretary can upload HOA document files" policies, untouched here).

drop policy if exists "Admin and Secretary can view documents" on public.documents;
create policy "Admin, Secretary and Treasurer can view documents"
on public.documents
for select
to authenticated
using (
  (select public.current_user_role()) in ('admin', 'secretary', 'treasurer')
);

drop policy if exists "Admin and Secretary can read HOA document files" on storage.objects;
create policy "Admin, Secretary and Treasurer can read HOA document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hoa-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (select public.current_user_role()) in ('admin', 'secretary', 'treasurer')
);

commit;
