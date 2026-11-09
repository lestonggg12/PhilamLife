-- Stops future expiry cleanup. Already-deleted bell notices cannot be restored by this file.
-- Permanent activity and financial records remain intact.
begin;
select cron.unschedule(jobid) from cron.job where jobname='prune-expired-notifications';
alter policy notifications_staff_read on public.notifications using ((select public.current_user_role()) in ('admin','secretary','treasurer'));
drop trigger zzzz_notification_retention on public.notifications;
drop function system_notification_private.prune_notifications(timestamptz);
drop function system_notification_private.prepare_notification_retention();
drop table system_notification_private.notification_delivery_keys;
alter table public.notifications drop column expires_at;
drop function system_notification_private.notification_expiry(timestamptz);
commit;
