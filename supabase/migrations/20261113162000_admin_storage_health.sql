-- Read-only Admin storage and system health metrics.
-- Does not alter financial data, notification retention or archiving.
CREATE OR REPLACE FUNCTION public.admin_storage_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.current_user_role() IS DISTINCT FROM 'admin'
  THEN
    RAISE EXCEPTION 'Admin access required'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'sampled_at', now(),
      'database_bytes', pg_catalog.pg_database_size(
        pg_catalog.current_database()
      ),
      'storage_bytes', (
        SELECT COALESCE(SUM(
          CASE
            WHEN metadata->>'size' ~ '^[0-9]{1,18}$'
            THEN (metadata->>'size')::bigint
            ELSE 0
          END
        ), 0)
        FROM storage.objects
      ),
      'storage_objects', (
        SELECT COUNT(*) FROM storage.objects
      ),
      'document_objects', (
        SELECT COUNT(*) FROM storage.objects
        WHERE bucket_id = 'hoa-documents'
      ),
      'activity_log_rows', (
        SELECT COUNT(*) FROM public.activity_log
      ),
      'notification_rows', (
        SELECT COUNT(*) FROM public.notifications
      ),
      'archive_enabled', (
        SELECT enabled FROM activity_archive_private.config
        WHERE id = true
      ),
      'archive_ready', (
        SELECT storage_ready FROM activity_archive_private.config
        WHERE id = true
      ),
      'archived_records', (
        SELECT COALESCE(SUM(row_count), 0)
        FROM public.activity_log_archives
        WHERE state = 'complete'
      ),
      'eligible_archive_rows', (
        SELECT COUNT(*)
        FROM public.activity_log
        WHERE created_at < activity_archive_private.cutoff()
      ),
      'largest_tables', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'name', t.relname,
            'bytes', t.bytes
          ) ORDER BY t.bytes DESC
        ), '[]'::jsonb)
        FROM (
          SELECT c.relname,
                 pg_catalog.pg_total_relation_size(c.oid) AS bytes
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n
            ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('r', 'p', 'm')
          ORDER BY bytes DESC
          LIMIT 5
        ) t
      )
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_storage_health()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_storage_health()
TO authenticated;