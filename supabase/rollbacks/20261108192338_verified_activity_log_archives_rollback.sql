-- Non-destructive rollback: stop archiving, KEEP archive files, manifests and
-- staff reader permissions. Dropping them would strand already-archived history.
begin;
update activity_archive_private.config set enabled=false,installed=false where id;
select cron.unschedule(jobid) from cron.job where jobname='archive-old-activity-logs';
commit;
