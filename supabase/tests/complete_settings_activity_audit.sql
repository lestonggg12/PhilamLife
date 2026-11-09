-- After the complete_settings_activity_audit migration. All test writes roll back.
-- Only nonfinancial settings (address/contact phone) are changed in the test.
begin;
create function pg_temp.audit_check(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end $$;
create temp table audit_fixture as select
 (select id from public.profiles where role='admin' and is_active limit 1) actor,
 (select coalesce(max(id),0) from public.activity_log) starting_id,
 'Audit fixture; second line '||repeat('complete description ',50)||'END-OF-SETTINGS-AUDIT' as long_address;
select pg_temp.audit_check((select actor is not null from audit_fixture),'existing active test admin is available');
select set_config('request.jwt.claim.sub',(select actor::text from audit_fixture),true);
update public.system_settings set address=(select long_address from audit_fixture) where id=1;
select pg_temp.audit_check((select count(*)=1 from public.activity_log where id>(select starting_id from audit_fixture) and action='Settings Updated'),'one settings audit per update');
select pg_temp.audit_check((select length(target)>500 and strpos(target,(select long_address from audit_fixture))>0 and target like '%END-OF-SETTINGS-AUDIT%'
 from public.activity_log where id>(select starting_id from audit_fixture) and action='Settings Updated'),'complete description beyond character 500 is saved');
create temp table audit_after_change as select count(*) as logs from public.activity_log;
update public.system_settings set address=address,updated_by=(select actor from audit_fixture) where id=1;
select pg_temp.audit_check((select count(*)=(select logs from audit_after_change) from public.activity_log),'no log for an unchanged value or recorder/timestamp-only update');
update public.system_settings set contact_phone='Audit phone fixture' where id=1;
update public.system_settings set contact_phone=null where id=1;
select pg_temp.audit_check((select target like '%contact_phone: Audit phone fixture → empty%' from public.activity_log where action='Settings Updated' order by id desc limit 1),'clearing a value is documented');
do $$ declare previous_actor text; before_address text; blocked boolean:=false;
begin
 previous_actor:=current_setting('request.jwt.claim.sub',true);
 select address into before_address from public.system_settings where id=1;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  update public.system_settings set address='Must roll back because the required audit has no staff actor' where id=1;
 exception when insufficient_privilege then blocked:=true;
 end;
 perform set_config('request.jwt.claim.sub',previous_actor,true);
 perform pg_temp.audit_check(blocked,'an update is rejected when its required audit cannot identify a staff actor');
 perform pg_temp.audit_check((select address is not distinct from before_address from public.system_settings where id=1),'failed audit rolls back its settings update');
end $$;
select pg_temp.audit_check(not has_function_privilege('authenticated','public.audit_settings_change()','EXECUTE'),'internal audit trigger is not exposed as a browser API');
select 'COMPLETE SETTINGS AUDIT AND FAILURE ATOMICITY PASSED' result;
rollback;
