-- ISOLATED CONTRACT TESTS ONLY. All seeded changes below roll back.
begin;
create function pg_temp.check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
insert into auth.users values('00000000-0000-0000-0000-000000000001');
insert into public.profiles(id,role,is_active,full_name) values('00000000-0000-0000-0000-000000000001','admin',true,'Test Admin');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
insert into public.properties(id,homeowner_name,block,lot_number,current_balance,property_classification,homeowner_status,lot_size_sqm,homeowner_id)
 values(1,'Full Credit','A',1,-150,'homeowner','active',100,gen_random_uuid()),
 (2,'Partial Credit','A',2,-40,'lot_owner','active',100,gen_random_uuid()),
 (3,'No Credit','A',3,200,'homeowner','active',100,gen_random_uuid());
insert into public.property_charges(property_id,charge_type,billing_month,amount,created_by_name)
 select id,'Association Dues','2026-11-01',100,'System (automatic)' from public.properties;
select pg_temp.check((select count(*)=2 from public.notifications where kind='credit_applied'),'only actual credit usage is notified');
select pg_temp.check((select current_balance=-50 from public.properties where id=1),'full credit money effect unchanged');
select pg_temp.check((select current_balance=60 from public.properties where id=2),'partial credit money effect unchanged');
select pg_temp.check((select current_balance=300 from public.properties where id=3),'no credit money effect unchanged');
select pg_temp.check((select (payload->>'credit_used')::numeric=100 and body like '%₱100.00%' from public.account_activity where property_id=1),'full credit event amount');
select pg_temp.check((select (payload->>'credit_used')::numeric=40 and (payload->>'unpaid_charge')::numeric=60 from public.account_activity where property_id=2),'partial credit event amount');
select pg_temp.check(system_notification_private.rate_label(.03)='3%' and system_notification_private.rate_label(.015)='1.5%' and system_notification_private.rate_label(.0175)='1.75%','rate labels match actual configured precision');
insert into public.annual_penalty_assessments(property_id,base_amount,rate,penalty_amount,charge_id,assessed_on,anniversary_date,origin)
 values(2,1000,.0175,17.50,gen_random_uuid(),'2026-11-08','2026-11-08','scheduled_system');
select pg_temp.check((select count(*)=1 and bool_and(body like '%1.75%%' and body like '%₱17.50%') from public.notifications where kind='penalty_applied'),'actual override rate and penalty amount');
insert into public.late_payment_penalties(property_id,base_amount,rate,penalty_amount,charge_id,anniversary_date)
 select property_id,base_amount,rate,penalty_amount,charge_id,anniversary_date from public.annual_penalty_assessments;
select pg_temp.check((select count(*)=1 from public.notifications where kind='penalty_applied'),'shared penalty charge is not double notified');

insert into public.payments(id,property_id,amount_paid,status,receipt_number) values('00000000-0000-0000-0001-000000000001',1,50,'Paid','OR-test');
insert into public.balance_entries(property_id,amount) values(1,200);
insert into public.service_transactions(property_id,amount_paid,receipt_number,payment_status,balance_of)
 values(1,100,'SR-original','paid',null),(1,20,'SR-settlement','paid',gen_random_uuid()),(null,75,'SR-guest','paid',null);
insert into public.expenses(amount,status,reference_number) values(50,'Active','EXP-test');
update public.payments set status='Voided',voided_at=now(),voided_by=auth.uid(),void_reason='Duplicate receipt';
update public.balance_entries set voided_at=now(),voided_by=auth.uid(),void_reason='Wrong balance';
update public.service_transactions set payment_status='voided',voided_at=now(),voided_by=auth.uid(),void_reason='Cancelled booking';
update public.expenses set status='Voided',voided_at=now(),voided_by=auth.uid(),void_reason='Duplicate expense';
-- Three new monthly charges were inserted earlier. Each supported charge void is observed.
update public.property_charges set voided_at=now(),voided_by=auth.uid(),void_reason='Wrong charge';
select pg_temp.check((select count(*)=9 from public.notifications where kind='transaction_voided'),'all five void categories, settlement and guest receipts, and each charge');
select pg_temp.check((select count(*)=7 from public.account_activity where kind='transaction_voided'),'expenses and guest receipts are not misattributed to a lot');
select pg_temp.check((select count(*)=1 from public.notifications where title='Service settlement receipt voided'),'service settlement identified');
select pg_temp.check((select count(*)=1 from public.notifications where title='Expense voided' and link='/expenses'),'expense deep link');
update public.payments set status='Voided';
update public.property_charges set void_reason=void_reason;
select pg_temp.check((select count(*)=9 from public.notifications where kind='transaction_voided'),'void retries do not duplicate');

insert into public.account_adjustments(id,property_id,balance_effect) values(gen_random_uuid(),1,-25);
update public.account_adjustments set reversed_at=now(),reversed_by=auth.uid(),reversal_reason='Correction reversed';
select pg_temp.check((select count(*)=1 from public.notifications where title='Balance adjustment reversed'),'direct adjustment reversal');
update public.system_settings set price_per_sqm=2,updated_by=auth.uid();
update public.system_settings set price_per_sqm=2;
select pg_temp.check((select count(*)=1 from public.notifications where title='System settings updated'),'setting no-op suppressed');
select pg_temp.check((select body like '%₱1.00/sqm → ₱2.00/sqm%' from public.notifications where title='System settings updated'),'price old-to-new values');
insert into public.annual_penalty_rate_rules(property_classification,effective_from,annual_rate,created_by)
 values('lot_owner','2026-11-01',.015,auth.uid()),('homeowner','2026-11-01',.03,auth.uid());
insert into public.annual_penalty_rate_overrides(property_classification,effective_from,annual_rate,rule_note,created_by)
 values('lot_owner','2026-11-08',.02,'Board amendment',auth.uid());
select pg_temp.check((select count(*)=3 from public.notifications where title like 'Annual penalty rate%'),'both classifications and override are observed');
select pg_temp.check((select body like '%1.5% to 2%%' from public.notifications where payload->>'source_table'='annual_penalty_rate_overrides'),'override previous and new rates');
insert into public.expense_budgets values(2026,'Utilities',12000,'Board approval',auth.uid(),now());
update public.expense_budgets set approved_annual_amount=24000 where budget_year=2026;
update public.expense_budgets set approved_annual_amount=24000 where budget_year=2026;
select pg_temp.check((select count(*)=2 from public.notifications where title='Expense budget updated'),'budget create/change observed, no-op excluded');
select pg_temp.check((select count(*)=0 from public.account_activity where kind='settings_changed'),'global settings stay out of property history');

update public.properties set homeowner_status='moved',status_effective_date='2026-11-08',status_reason='Moved out' where id=1;
set constraints all immediate;
select pg_temp.check((select count(*)=1 from public.account_activity where property_id=1 and kind='ownership_changed'),'move event in account history');
set constraints all deferred;
update public.properties set homeowner_status='transferred',status_effective_date='2026-11-08' where id=2;
insert into public.properties(id,homeowner_name,block,lot_number,current_balance,property_classification,homeowner_status,lot_size_sqm,homeowner_id)
 values(4,'New Owner','A',2,0,'lot_owner','active',100,gen_random_uuid());
insert into public.homeowner_balance_transfers(id,previous_property_id,new_property_id,transferred_balance,effective_date,note,created_by)
 values(gen_random_uuid(),2,4,40,'2026-11-08','Ownership transferred',auth.uid());
set constraints all immediate;
select pg_temp.check((select count(*)=2 from public.notifications where kind='ownership_changed'),'one move and one transfer; no duplicate transfer status notice');
select pg_temp.check((select count(*)=2 from public.account_activity where property_id in (2,4) and kind='ownership_changed'),'transfer appears on old and new accounts');

-- Cascading penalties are grouped under the originating balance void.
insert into public.balance_entries(id,property_id,amount) values('00000000-0000-0000-0002-000000000001',3,100);
insert into public.annual_penalty_schedules(id,source_kind,source_ref,property_id)
 values('00000000-0000-0000-0002-000000000002','entry','00000000-0000-0000-0002-000000000001',3);
insert into public.property_charges(id,property_id,charge_type,amount)
 values('00000000-0000-0000-0002-000000000003',3,'Penalty / Late Fee',3);
insert into public.annual_penalty_assessments(schedule_id,property_id,base_amount,rate,penalty_amount,charge_id,assessed_on,anniversary_date,origin)
 values('00000000-0000-0000-0002-000000000002',3,100,.03,3,'00000000-0000-0000-0002-000000000003','2026-11-08','2026-11-08','staff');
create temp table before_cascade as select count(*) as n from public.notifications where kind='transaction_voided';
update public.balance_entries set voided_at=now(),voided_by=auth.uid(),void_reason='Source correction' where id='00000000-0000-0000-0002-000000000001';
select pg_temp.check((select count(*)=(select n+1 from before_cascade) from public.notifications where kind='transaction_voided'),'cascade produces one parent void notice');
select pg_temp.check((select jsonb_array_length(payload->'related_reversals')=1 from public.notifications where payload->>'source_id'='00000000-0000-0000-0002-000000000001'),'parent notice includes the penalty reversal');
select pg_temp.check((select voided_at is not null from public.property_charges where id='00000000-0000-0000-0002-000000000003'),'source penalty still reverses normally');

-- Observers themselves never modify money. Repeating one event is idempotent.
create temp table financial_snapshot as select md5(string_agg(to_jsonb(p)::text,'' order by id)) as hash from public.properties p;
select system_notification_private.emit_event('verification:event','credit_applied','Verification','No financial effects',array[1::bigint],null,null,now(),'/homeowners/1');
select system_notification_private.emit_event('verification:event','credit_applied','Verification','No financial effects',array[1::bigint],null,null,now(),'/homeowners/1');
select pg_temp.check((select count(*)=1 from public.notifications where dedupe_key='verification:event'),'event deduplication');
select pg_temp.check((select hash=(select md5(string_agg(to_jsonb(p)::text,'' order by id)) from public.properties p) from financial_snapshot),'emitter preserves balances');
select pg_temp.check(not has_table_privilege('authenticated','public.account_activity','insert') and not has_table_privilege('authenticated','public.account_activity','delete') and not has_table_privilege('anon','public.account_activity','select'),'history write and anon permissions');
select pg_temp.check(not has_schema_privilege('authenticated','system_notification_private','usage'),'browser cannot invoke observers');
set local role authenticated;
select pg_temp.check((select count(*)>0 from public.account_activity),'staff reads account history including own actions');
reset role;
select 'STAFF EVENT NOTIFICATION TESTS PASSED' as result;
rollback;
