-- Removes notification data only. Review before use; financial records are untouched.
begin;
select cron.unschedule(jobid) from cron.job where jobname in ('snapshot-collection-notifications','generate-system-notifications');
drop function public.generate_system_notifications();
drop function public.snapshot_collection_balances();
drop table public.notification_reads;
drop table public.notifications;
drop function system_notification_private.generate(date);
drop function system_notification_private.capture(timestamptz);
drop function system_notification_private.peso(numeric);
drop function system_notification_private.collection_date(date,integer);
drop table system_notification_private.collection_snapshots;
drop table system_notification_private.state;
drop schema system_notification_private;
commit;
