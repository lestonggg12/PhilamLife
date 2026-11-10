begin;
set local lock_timeout = '5s';

-- Roll the client back before this migration. Keep recorded upload events.
drop view public.document_upload_report;
drop function public.register_document_upload(text,text,text,text,text,bigint);
drop trigger verify_document_upload on public.documents;
drop trigger record_document_upload_event on public.documents;
drop trigger retain_document_upload_event on public.documents;
drop function public.verify_document_upload();
drop function public.record_document_upload_event();

alter policy "Admin and Secretary can delete HOA document files" on storage.objects
  using (((bucket_id = 'hoa-documents'::text) AND ((storage.foldername(name))[1] = 'documents'::text) AND (( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text])) AND ((EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.storage_path = objects.name) AND (d.deletion_requested_at IS NOT NULL)))) OR ((owner_id = ( SELECT (auth.uid())::text AS uid)) AND (NOT (EXISTS ( SELECT 1
   FROM documents d
  WHERE (d.storage_path = objects.name))))))));

alter policy "Secretary can upload HOA document files" on storage.objects
  with check (((bucket_id = 'hoa-documents'::text) AND ((storage.foldername(name))[1] = 'documents'::text) AND (( SELECT current_user_role() AS current_user_role) = 'secretary'::text) AND (NOT (EXISTS ( SELECT 1
   FROM documents d
  WHERE (d.storage_path = objects.name))))));

alter policy "Admin, Secretary and Treasurer can read HOA document files" on storage.objects
  using (((bucket_id = 'hoa-documents'::text) AND ((storage.foldername(name))[1] = 'documents'::text) AND ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text])) OR ((( SELECT current_user_role() AS current_user_role) = 'treasurer'::text) AND (EXISTS ( SELECT 1
   FROM documents d
  WHERE ((d.storage_path = objects.name) AND (d.deletion_requested_at IS NULL))))))));

commit;
