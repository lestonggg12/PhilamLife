-- Restrict Treasurer downloads to published HOA documents.
-- Preserve Admin/Secretary access for pending-deletion cleanup.

DROP POLICY IF EXISTS
  "Admin, Secretary and Treasurer can read HOA document files"
ON storage.objects;

CREATE POLICY "Admin, Secretary and Treasurer can read HOA document files"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'hoa-documents'
  AND (storage.foldername(name))[1] = 'documents'
  AND (
    (SELECT public.current_user_role()) IN ('admin', 'secretary')
    OR (
      (SELECT public.current_user_role()) = 'treasurer'
      AND EXISTS (
        SELECT 1
        FROM public.documents d
        WHERE d.storage_path = storage.objects.name
          AND d.deletion_requested_at IS NULL
      )
    )
  )
);
