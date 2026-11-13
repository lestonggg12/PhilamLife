-- Keep the current Manila calendar month and the previous 12 complete months.
-- Archive only older activity through the existing verified archive worker.
-- Notification-bell retention is deliberately unchanged.

CREATE OR REPLACE FUNCTION activity_archive_private.cutoff(
    p_clock timestamptz DEFAULT now()
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
    SELECT (
        date_trunc('month', p_clock AT TIME ZONE 'Asia/Manila')
        - interval '12 months'
    ) AT TIME ZONE 'Asia/Manila';
$function$;