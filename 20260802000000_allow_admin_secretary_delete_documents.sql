begin;

grant select, delete on table public.documents to authenticated;

drop policy if exists "Secretary can view documents" on public.documents;
drop policy if exists "Admin and Secretary can view documents" on public.documents;
create policy "Admin and Secretary can view documents"
on public.documents
for select
to authenticated
using (
  (select public.current_user_role()) in ('admin', 'secretary')
);

drop policy if exists "Admin and Secretary can delete documents" on public.documents;
create policy "Admin and Secretary can delete documents"
on public.documents
for delete
to authenticated
using (
  (select public.current_user_role()) in ('admin', 'secretary')
);

drop policy if exists "Secretary can read HOA document files" on storage.objects;
drop policy if exists "Admin and Secretary can read HOA document files" on storage.objects;
create policy "Admin and Secretary can read HOA document files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'hoa-documents'
  and (storage.foldername(name))[1] = 'documents'
  and (select public.current_user_role()) in ('admin', 'secretary')
);

drop policy if exists "Secretary can remove failed HOA document uploads" on storage.objects;
drop policy if exists "Admin and Secretary can delete HOA document files" on storage.objects;
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
