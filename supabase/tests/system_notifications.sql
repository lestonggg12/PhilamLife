-- Run ONLY on a disposable database with the supplied contract fixture,
-- after applying the notification migration there. Everything below rolls back.
begin;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create function pg_temp.money_hash() returns text language sql as $$
 select md5(concat(
  (select string_agg(to_jsonb(t)::text,'' order by id) from public.property_charges t),
  (select string_agg(to_jsonb(t)::text,'' order by id) from public.properties t),
  (select string_agg(to_jsonb(t)::text,'' order by id) from public.payments t),
  (select string_agg(to_jsonb(t)::text,'' order by id) from public.late_payment_penalties t),
  (select string_agg(to_jsonb(t)::text,'' order by id) from public.annual_penalty_assessments t)))
$$;
create function pg_temp.reset_clock(d date,bday integer) returns void language plpgsql as $$
begin
  delete from public.notification_reads; delete from public.notifications;
  delete from system_notification_private.collection_snapshots;
  update system_notification_private.state set started_on=d,last_reminder_day=d-1;
  update public.system_settings set billing_day=bday where id=1;
end $$;
insert into public.properties(id,homeowner_name,block,lot_number,current_balance,property_classification,homeowner_status,lot_size_sqm) values
 (1,'Fully covered','A',1,-150,'homeowner','active',100),
 (2,'Partly covered','A',2,-40,'lot_owner','active',100),
 (3,'No credit','A',3,200,'unclassified','active',100);


-- Exact day, no adjacent-day reminder; capped date April 30 and month-crossing May 1.
select pg_temp.reset_clock('2026-04-22',31);
select system_notification_private.generate('2026-04-22');
select pg_temp.assert((select count(*)=0 from public.notifications),'no -8 reminder');
select system_notification_private.generate('2026-04-23');
select pg_temp.assert((select count(*)=1 from public.notifications where dedupe_key='collection_reminder:2026-04-30'),'30-day cap reminder at -7');
select pg_temp.assert((select (payload->>'unclassified')::integer=1 and (payload->>'total')::numeric=200 from public.notifications),'reminder classification and total');
select system_notification_private.generate('2026-04-24');
select pg_temp.assert((select count(*)=1 from public.notifications),'no -6 reminder');
select system_notification_private.generate('2026-04-24');
select pg_temp.assert((select count(*)=1 from public.notifications),'reminder retry dedupes');
select pg_temp.reset_clock('2026-04-23',1);
select system_notification_private.generate('2026-04-23');
select system_notification_private.generate('2026-04-24');
select pg_temp.assert((select count(*)=1 from public.notifications where dedupe_key='collection_reminder:2026-05-01'),'cross-month -7 reminder');
select pg_temp.reset_clock('2026-04-23',31);
select system_notification_private.generate('2026-04-24');
select pg_temp.assert((select count(*)=1 and bool_and(body like 'Delayed reminder%') from public.notifications),'missed-day reminder catch-up labeled');

-- Collection fixture: snapshot BEFORE the isolated test simulates three posted charges.
select pg_temp.reset_clock('2026-05-01',1);
select system_notification_private.capture('2026-04-30 00:00:00+08');
select pg_temp.assert((select count(*)=0 from system_notification_private.collection_snapshots),'non-collection date has no snapshot');
create temp table before_capture_hash as select pg_temp.money_hash() as hash;
select system_notification_private.capture('2026-05-01 00:00:00+08');
select pg_temp.assert((select hash=pg_temp.money_hash() from before_capture_hash),'first snapshot preserves all financial hashes');
select system_notification_private.generate('2026-05-01');
select pg_temp.assert((select count(*)=0 from public.notifications),'pending billing does not generate a false successful report');
insert into public.property_charges(property_id,charge_type,billing_month,amount,created_at,created_by_name)
 select id,'Association Dues','2026-05-01',100,'2026-05-01 00:05:00+08','System (automatic)' from public.properties;
update public.properties set current_balance=current_balance+100;
-- Allocation inputs: partial-credit dues remain current on the due day. The third
-- lot has both an old unpaid balance and today's dues. Run the exact live view.
insert into public.property_balance_items(property_id,unpaid,item_date,ref_id,kind)
 select 2,60,'2026-05-01',id,'dues' from public.property_charges where property_id=2;
insert into public.property_balance_items(property_id,unpaid,item_date,ref_id,kind)
 select 3,100,'2026-05-01',id,'dues' from public.property_charges where property_id=3;
insert into public.property_balance_items values(3,200,'2026-04-30',gen_random_uuid(),'entry');
select pg_temp.assert((select not is_overdue and overdue_amount=0 from public.property_overdue_summary where property_id=2),'due-day equality is current in exact live view');
select pg_temp.assert((select is_overdue and overdue_amount=200 and current_amount=100 from public.property_overdue_summary where property_id=3),'exact live view separates old debt from current dues');
-- Snapshot retries cannot overwrite the original credit balances, including a late call.
select system_notification_private.capture('2026-05-01 00:01:00+08');
select system_notification_private.capture('2026-05-01 00:21:00+08');
select pg_temp.assert((select (accounts->0->>'balance')::numeric=-150 from system_notification_private.collection_snapshots),'immutable pre-billing snapshot');

-- Read-only observers must leave ALL financial rows byte-for-byte unchanged.
create temp table before_hash as select pg_temp.money_hash() as hash;
select system_notification_private.capture('2026-05-01 00:02:00+08');
select system_notification_private.generate('2026-05-01');
select system_notification_private.generate('2026-05-01');
select pg_temp.assert((select hash=pg_temp.money_hash() from before_hash),'snapshot and generator preserve financial hashes');
select pg_temp.assert((select count(*)=1 from public.notifications),'collection dedupes');
select pg_temp.assert((select
 (payload->>'credit_accounts')::integer=2 and (payload->>'credit_deducted')::numeric=140
 and (payload->>'fully_covered')::integer=1 and (payload->>'partly_covered')::integer=1
 and (payload->>'unpaid_accounts')::integer=1 and (payload->>'unpaid_total')::numeric=300
 and (payload->>'overdue_accounts')::integer=1 and body like '%₱140.00%'
 from public.notifications where kind='collection_run'),'3-lot counts and totals');

-- Canonical journal identifies scheduled anniversaries, scheduled catch-up and staff postings.
insert into public.annual_penalty_assessments(property_id,assessed_on,anniversary_date,origin,actor_user_id,penalty_amount,charge_id) values
 (1,'2026-05-01','2026-05-01','scheduled_system',null,30,gen_random_uuid()),
 (2,'2026-05-01','2026-04-30','scheduled_system',null,15,gen_random_uuid()),
 (3,'2026-05-01','2026-04-01','staff','00000000-0000-0000-0000-000000000001',900,gen_random_uuid());
update before_hash set hash=pg_temp.money_hash();
select system_notification_private.generate('2026-05-01');
select pg_temp.assert((select count(*)=1 from public.notifications where kind='penalty_anniversary'),'anniversary-today notification');
-- Simulate a missed notification run while retaining the financial journal.
delete from public.notifications where kind='penalty_anniversary';
select system_notification_private.generate('2026-05-02');
select system_notification_private.generate('2026-05-02');
select pg_temp.assert((select count(*)=1 from public.notifications where kind='penalty_anniversary'),'one penalty catch-up notification');
select pg_temp.assert((select (payload->>'balances')::integer=2 and (payload->>'total')::numeric=45
 and (payload->>'homeowners')::integer=1 and (payload->>'lot_owners')::integer=1
 and (payload->>'unclassified')::integer=0 and (payload->>'caught_up_balances')::integer=1
 from public.notifications where kind='penalty_anniversary'),'anniversary total excludes Add Balance / payment catch-up');
select pg_temp.assert((select hash=pg_temp.money_hash() from before_hash),'penalty journal remains unchanged');

-- Staff RLS, per-user reads and privilege boundaries.
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.profiles values('00000000-0000-0000-0000-000000000001','admin',true),
 ('00000000-0000-0000-0000-000000000002','secretary',true);
select pg_temp.assert(not has_table_privilege('anon','public.notifications','select'),'anon denied');
select pg_temp.assert(not has_table_privilege('authenticated','public.notifications','insert')
 and not has_table_privilege('authenticated','public.notifications','update')
 and not has_table_privilege('authenticated','public.notifications','delete'),'browser notification writes denied');
select pg_temp.assert(not has_function_privilege('authenticated','public.generate_system_notifications()','execute')
 and not has_function_privilege('anon','public.snapshot_collection_balances()','execute'),'browser generation denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert((select count(*)>0 from public.notifications),'admin reads notifications');
insert into public.notification_reads(notification_id,user_id) select id,auth.uid() from public.notifications;
insert into public.notification_reads(notification_id,user_id) select id,auth.uid() from public.notifications on conflict do nothing;
select pg_temp.assert((select count(*)>0 from public.notification_reads),'read insertion idempotent without update privilege');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert((select count(*)=0 from public.notification_reads),'other user cannot read receipts');
select pg_temp.assert((select count(*)>0 from public.notifications),'secretary reads notifications');
do $$ begin
  begin
    insert into public.notification_reads(notification_id,user_id) select id,'00000000-0000-0000-0000-000000000001'::uuid from public.notifications limit 1;
    raise exception 'FAIL: cross-user insert succeeded';
  exception when insufficient_privilege then null; end;
end $$;
delete from public.notification_reads;
reset role;
select pg_temp.assert((select count(*)>0 from public.notification_reads),'other user cannot delete reads');
update public.profiles set role='treasurer' where id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.assert((select count(*)>0 from public.notifications),'treasurer reads notifications');
reset role;
update public.profiles set is_active=false where id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.assert((select count(*)=0 from public.notifications),'inactive staff denied');
reset role;
select pg_temp.reset_clock('2026-06-01',1);
select system_notification_private.generate('2026-06-01');
select pg_temp.assert((select payload->>'snapshot_missing'='true' and severity='warning' from public.notifications),'missing snapshot never fabricates totals');
select pg_temp.assert((select count(*)=0 from public.notifications where kind='penalty_anniversary'),'zero penalties creates no notice');
select pg_temp.assert((select count(*)=2 from cron.job where jobname in ('snapshot-collection-notifications','generate-system-notifications')),'exactly two new scheduler jobs');
select 'SYSTEM NOTIFICATION SQL CONTRACT TESTS PASSED' as result;
rollback;
