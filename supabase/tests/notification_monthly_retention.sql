-- Run after the notification retention migration. Entire test rolls back.
-- Uses only notification/read/activity fixtures; no financial transactions are written.
begin;
create function pg_temp.retention_financial_inventory() returns jsonb language plpgsql as $$
declare hashes jsonb:='{}'; r record; h text;
begin
 for r in select tablename from pg_tables where schemaname='public' and tablename in
 ('properties','property_charges','payments','balance_entries','late_payment_penalties','annual_penalty_assessments','account_adjustments','service_transactions','expenses','expense_budgets','system_settings','homeowner_balance_transfers','penalty_rate_rules','penalty_rate_overrides','activity_log') order by tablename loop
  execute format('select md5(coalesce(string_agg(row_value::text,'''' order by row_value::text),'''')) from (select to_jsonb(t) row_value from public.%I t) rows',r.tablename) into h;
  hashes:=hashes||jsonb_build_object(r.tablename,h);
 end loop;
 return jsonb_build_object('records',hashes,
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p')),
 'overdue',(select md5(pg_get_viewdef('public.property_overdue_summary'::regclass,true))),
 'jobs',(select md5(string_agg(to_jsonb(j)::text,'' order by jobname)) from cron.job j where jobname<>'prune-expired-notifications'));
end $$;
create temp table retention_financial_before as select pg_temp.retention_financial_inventory() inventory;

create function pg_temp.retention_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create temp table retention_context as select gen_random_uuid() expired_id,gen_random_uuid() current_id,
 gen_random_uuid() history_id,gen_random_uuid()::text token,
 (select id from public.profiles where role='admin' and is_active limit 1) staff_id;
select pg_temp.retention_check((select staff_id is not null from retention_context),'an existing active test admin is available');
grant select on retention_context to authenticated;
select pg_temp.retention_check(system_notification_private.notification_expiry('2027-01-30 16:30:00+00')='2027-02-27 16:30:00+00','January 31 in Manila clamps to February 28 at the same local time');
select pg_temp.retention_check(system_notification_private.notification_expiry('2028-01-30 16:30:00+00')='2028-02-28 16:30:00+00','leap February clamps to February 29');
select pg_temp.retention_check(system_notification_private.notification_expiry('2026-03-30 16:30:00+00')='2026-04-29 16:30:00+00','March 31 clamps to April 30');
select pg_temp.retention_check(system_notification_private.notification_expiry('2026-11-08 10:41:42+00')='2026-12-08 10:41:42+00','one calendar month preserves the creation time');
insert into public.notifications(id,kind,dedupe_key,title,body,created_at)
 select expired_id,'settings_changed','retention-test-old:'||token,'Old test notice','Old notification body',now()-interval '2 months' from retention_context
 union all select current_id,'settings_changed','retention-test-new:'||token,'Current test notice','Current notification body',now() from retention_context;
insert into public.notification_reads(notification_id,user_id) select expired_id,staff_id from retention_context;
insert into public.account_activity(id,notification_id,property_id,dedupe_key,kind,title,body,payload)
 select history_id,expired_id,(select id from public.properties limit 1),'retention-history:'||token,
 'transaction_voided','Permanent test history','Keep this cancellation explanation','{"amount_formatted":"₱100.00"}' from retention_context;
select set_config('request.jwt.claim.sub',(select staff_id::text from retention_context),true);
set local role authenticated;
select pg_temp.retention_check((select count(*)=0 from public.notifications n,retention_context c where n.id=c.expired_id),'RLS hides expired notices before physical deletion');
select pg_temp.retention_check((select count(*)=1 from public.notifications n,retention_context c where n.id=c.current_id),'staff may read unexpired notices');
reset role;
select pg_temp.retention_check(not has_function_privilege('authenticated','system_notification_private.prune_notifications(timestamptz)','EXECUTE'),'browser cannot run cleanup');
select pg_temp.retention_check(not has_table_privilege('authenticated','public.notifications','INSERT') and not has_table_privilege('anon','public.notifications','SELECT'),'browser cannot create notices; anon cannot read them');
select pg_temp.retention_check(not has_table_privilege('authenticated','system_notification_private.notification_delivery_keys','SELECT'),'delivery keys stay private');
select system_notification_private.prune_notifications((select expires_at-interval '1 microsecond' from public.notifications n,retention_context c where n.id=c.expired_id));
select pg_temp.retention_check((select count(*)=1 from public.notifications n,retention_context c where n.id=c.expired_id),'notice remains just before expiry');
select system_notification_private.prune_notifications((select expires_at from public.notifications n,retention_context c where n.id=c.expired_id));
select pg_temp.retention_check((select count(*)=0 from public.notifications n,retention_context c where n.id=c.expired_id),'expired notice deleted');
select pg_temp.retention_check((select count(*)=0 from public.notification_reads r,retention_context c where r.notification_id=c.expired_id),'read marker cascades');
select pg_temp.retention_check((select count(*)=1 from public.account_activity a,retention_context c where a.id=c.history_id and a.notification_id is null and a.body='Keep this cancellation explanation' and a.payload->>'amount_formatted'='₱100.00'),'permanent account history retained');
select pg_temp.retention_check((select count(*)=1 from public.notifications n,retention_context c where n.id=c.current_id),'current notice retained');
-- A generator catching up on an old date must not resurrect a deleted notice.
insert into public.notifications(kind,dedupe_key,title,body)
 select 'settings_changed','retention-test-old:'||token,'Re-announced old notice','Must not appear' from retention_context;
select pg_temp.retention_check((select count(*)=0 from public.notifications n,retention_context c where n.dedupe_key='retention-test-old:'||c.token),'old delivery key prevents resurrection');
insert into public.notifications(kind,dedupe_key,title,body)
 select 'settings_changed','retention-test-new:'||token,'Duplicate current notice','Must not duplicate' from retention_context;
select pg_temp.retention_check((select count(*)=1 from public.notifications n,retention_context c where n.dedupe_key='retention-test-new:'||c.token),'reruns remain idempotent');
select pg_temp.retention_check((select count(*)=1 from cron.job where jobname='prune-expired-notifications' and schedule='15 * * * *'),'hourly purge job exists');
select pg_temp.retention_check((select schedule='5 16 * * *' and command='select public.bill_monthly_dues()' from cron.job where jobname='bill-monthly-dues'),'billing cron unchanged');
select pg_temp.retention_check((select schedule='10 16 * * *' and command='select public.post_due_penalties()' from cron.job where jobname='post-late-penalties'),'penalty cron unchanged');
select pg_temp.retention_check((select inventory=pg_temp.retention_financial_inventory() from retention_financial_before),'financial records, raw audit log, public functions, overdue view and existing cron jobs unchanged');
select 'RETENTION, MANILA MONTH BOUNDARIES, PRIVACY, HISTORY AND DEDUPLICATION PASSED' as result;
rollback;
