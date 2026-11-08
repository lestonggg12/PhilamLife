-- ISOLATED fixture contract tests. All seeded changes roll back.
begin;
create function pg_temp.check(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
insert into public.profiles values('00000000-0000-0000-0000-000000000001','admin',true,'Test Admin','test@example.com'),('00000000-0000-0000-0000-000000000002','secretary',true,'Test Secretary','secretary@example.com');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.check(activity_archive_private.cutoff('2027-01-01T00:00:00+08')='2026-12-01T00:00:00+08','January retains December and January');
select pg_temp.check(activity_archive_private.cutoff('2026-12-01T00:00:00+08')='2026-11-01T00:00:00+08','December retains November and December');
select pg_temp.check(activity_archive_private.cutoff('2027-01-31T16:00:00Z')='2027-01-01T00:00:00+08','month rollover uses Manila even on the previous UTC date');
select pg_temp.check(activity_archive_private.cutoff('2028-03-01T00:00:00+08')='2028-02-01T00:00:00+08','leap February is retained correctly');
select pg_temp.check(not has_function_privilege('authenticated','public.activity_archive_finish(uuid,uuid,text,text,integer)','execute'),'browser cannot finalize or delete source logs');
select pg_temp.check(not has_function_privilege('authenticated','public.activity_archive_claim()','execute'),'browser cannot claim raw snapshots');
select pg_temp.check(not has_function_privilege('anon','public.activity_archive_auth(text)','execute'),'anonymous caller cannot validate scheduler credentials');
select pg_temp.check(not has_table_privilege('authenticated','public.activity_log_archives','insert'),'browser cannot forge an archive manifest');
select pg_temp.check(public.activity_archive_auth(repeat('x',64))=false,'wrong worker token rejected');
select pg_temp.check(public.activity_archive_auth((select secret from vault.secrets where name='philamlife_activity_archive_worker')),'correct private worker token accepted');
insert into public.activity_log(id,user_id,action,target,created_at) values
 (1001,auth.uid(),'Settings Updated',repeat('Full text; ',90)||'KEEP-END',activity_archive_private.cutoff()-interval '1 day'),
 (1002,auth.uid(),'Payment Voided','Receipt cancelled; reason retained',activity_archive_private.cutoff()-interval '2 days'),
 (1003,auth.uid(),'Payment Recorded','Previous month must stay live',activity_archive_private.cutoff()),
 (1004,auth.uid(),'Receipt Viewed','Current month must stay live',now());
select pg_temp.check(public.activity_archive_claim()->>'state'='disabled','no archiving before activation');
do $$begin begin perform public.set_activity_archive_enabled(true,1);raise exception 'Readiness should block';exception when raise_exception then if sqlerrm='Readiness should block' then raise;end if;end;end$$;
select public.activity_archive_health(true);
select public.set_activity_archive_enabled(true,1);
create temp table batch as select public.activity_archive_claim() as result;
select pg_temp.check((select (result->'manifest'->>'row_count')::int=2 from batch),'only eligible old source rows selected');
select pg_temp.check((select result->>'payload' like '%KEEP-END%' from batch),'full long audit text captured without truncation');
select pg_temp.check((select result->>'payload' like '%Test Admin%' from batch),'actor identity captured with immutable archive payload');
select pg_temp.check(public.activity_archive_claim()->>'state'='busy','concurrent claim cannot overlap an active batch');
set local role authenticated;
select pg_temp.check((select count(*)=0 from public.activity_log_archives),'pending manifests are hidden from staff');
reset role;
-- A checksum mismatch must not remove anything, even if an object exists.
insert into storage.buckets values('activity-log-archives',false);
do $$declare b jsonb;begin select result into b from batch;
 begin perform public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,b->'manifest'->>'raw_sha256',repeat('a',64),128);raise exception 'Missing object should block';exception when raise_exception then if sqlerrm not like 'Private archive object%' then raise;end if;end;
end$$;
insert into storage.objects(bucket_id,name,metadata) select 'activity-log-archives',result->'manifest'->>'object_path','{"size":128}' from batch;
do $$declare b jsonb;begin select result into b from batch;
 begin perform public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,repeat('0',64),repeat('a',64),128);raise exception 'Bad checksum should block';exception when raise_exception then if sqlerrm='Bad checksum should block' then raise;end if;end;
 perform pg_temp.check((select count(*)=2 from public.activity_log where id in(1001,1002)),'checksum mismatch retains source records');
end$$;
-- Changed source data must block deletion, despite a successfully verified upload.
update public.activity_log set target='Different event contents' where id=1002;
do $$declare b jsonb;begin select result into b from batch;
 begin perform public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,b->'manifest'->>'raw_sha256',repeat('a',64),128);raise exception 'Changed source should block';exception when raise_exception then if sqlerrm='Changed source should block' then raise;end if;end;
end$$;
update public.activity_log set target='Receipt cancelled; reason retained' where id=1002;
update activity_archive_private.work set leased_until=now()-interval '1 second' where id;
create temp table renewed as select public.activity_archive_claim() result;
select pg_temp.check((select b.result->'manifest'->>'id'=r.result->'manifest'->>'id' and b.result->>'payload'=r.result->>'payload' and b.result->>'lease'<>r.result->>'lease' from batch b cross join renewed r),'retry reuses exact immutable payload and object path with a fresh lease');
do $$declare b jsonb;begin select result into b from batch;
 begin perform public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,b->'manifest'->>'raw_sha256',repeat('a',64),128);raise exception 'Old lease should block';exception when raise_exception then if sqlerrm='Old lease should block' then raise;end if;end;
end$$;
select pg_temp.check((select public.activity_archive_finish((result->'manifest'->>'id')::uuid,(result->>'lease')::uuid,result->'manifest'->>'raw_sha256',repeat('a',64),128)=2 from renewed),'verified finalization removes exactly its two old source rows');
select pg_temp.check((select count(*)=0 from public.activity_log where id in(1001,1002)),'only verified source rows removed');
select pg_temp.check((select count(*)=2 from public.activity_log where id in(1003,1004)),'current and previous month preserved');
select pg_temp.check((select count(*)=1 from public.activity_log_archives where state='complete' and row_count=2),'permanent complete manifest retained');
select pg_temp.check((select payload is null and source_ids is null from activity_archive_private.work where id),'transient snapshot released after completion');
set local role authenticated;
select pg_temp.check((select count(*)=1 from public.activity_log_archives),'staff can read completed index');
select pg_temp.check((select count(*)=1 from storage.objects where bucket_id='activity-log-archives'),'staff can read indexed private archives');
do $$begin begin insert into storage.objects(bucket_id,name,metadata)values('activity-log-archives','forged.json.gz','{}');raise exception 'Forged object should block';exception when insufficient_privilege then null;end;end$$;
delete from storage.objects where bucket_id='activity-log-archives';
select pg_temp.check((select count(*)=1 from storage.objects where bucket_id='activity-log-archives'),'staff cannot delete archive objects even under a broad existing policy');
reset role;
set local role anon;
select pg_temp.check((select count(*)=0 from storage.objects where bucket_id='activity-log-archives'),'anonymous users cannot read private archives even under a broad existing policy');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
do $$begin begin perform public.set_activity_archive_enabled(false,1);raise exception 'Secretary cannot toggle';exception when insufficient_privilege then null;end;end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
-- Future deletion dependencies must never cascade into financial records.
insert into public.activity_log(id,user_id,action,target,created_at)values(1005,auth.uid(),'Payment Recorded','Dependency test evidence',activity_archive_private.cutoff()-interval '1 day');
create temp table dependency_batch as select public.activity_archive_claim() result;
insert into storage.objects(bucket_id,name,metadata)select 'activity-log-archives',result->'manifest'->>'object_path','{"size":128}' from dependency_batch;
create table public.fixture_financial_audit_link(activity_id bigint references public.activity_log(id)on delete cascade,amount numeric);
insert into public.fixture_financial_audit_link values(1005,999);
do $$declare b jsonb;begin select result into b from dependency_batch;
 begin perform public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,b->'manifest'->>'raw_sha256',repeat('a',64),128);raise exception 'Dependency should block';exception when raise_exception then if sqlerrm not like 'Activity deletion dependencies%' then raise;end if;end;
 perform pg_temp.check((select amount=999 from public.fixture_financial_audit_link),'referencing financial record cannot be cascaded away');
end$$;
drop table public.fixture_financial_audit_link;
create function pg_temp.bad_delete_trigger()returns trigger language plpgsql as $$begin update public.payments set amount_paid=0;return old;end$$;
create trigger fixture_delete_effect after delete on public.activity_log for each row execute function pg_temp.bad_delete_trigger();
do $$declare b jsonb;begin select result into b from dependency_batch;
 begin perform public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,b->'manifest'->>'raw_sha256',repeat('a',64),128);raise exception 'Delete trigger should block';exception when raise_exception then if sqlerrm not like 'Activity deletion dependencies%' then raise;end if;end;
 perform pg_temp.check((select amount_paid=100 from public.payments where id=1),'future delete triggers cannot change money records');
end$$;
drop trigger fixture_delete_effect on public.activity_log;
insert into storage.objects(bucket_id,name,metadata)values('other-documents','quota-fixture','{"size":800000000}');
select pg_temp.check(public.activity_archive_claim()->>'reason'='storage_near_limit','nearly full file storage pauses claims');
select pg_temp.check((select count(*)=1 from public.activity_log where id=1005),'storage pause preserves unconfirmed source record');
delete from storage.objects where name='quota-fixture';
-- Complete the retained dependency-test batch after its blockers are removed.
select public.activity_archive_finish((result->'manifest'->>'id')::uuid,(result->>'lease')::uuid,result->'manifest'->>'raw_sha256',repeat('a',64),128) from dependency_batch;
insert into public.activity_log(id,user_id,action,target,created_at)
 select 20000+g,auth.uid(),'Receipt Viewed','Complete paginated event '||g,activity_archive_private.cutoff()-interval '3 days' from generate_series(1,1001)g;
do $$declare b jsonb; removed integer:=0; batches integer:=0;
begin loop
 b:=public.activity_archive_claim();exit when b->>'state'<>'work';
 perform pg_temp.check((b->'manifest'->>'row_count')::integer<=500,'archive batches remain bounded');
 insert into storage.objects(bucket_id,name,metadata)values('activity-log-archives',b->'manifest'->>'object_path','{"size":128}');
 removed:=removed+public.activity_archive_finish((b->'manifest'->>'id')::uuid,(b->>'lease')::uuid,b->'manifest'->>'raw_sha256',repeat('a',64),128);
 batches:=batches+1;
end loop;
perform pg_temp.check(removed=1001 and batches=3,'all 1001 records archived across three batches without omission');
end$$;
select public.set_activity_archive_enabled(false,1);
select pg_temp.check(public.activity_archive_claim()->>'state'='disabled','pause stops further claims and cleanup');
select pg_temp.check((select count(*)=1 and sum(amount_paid)=100 from public.payments),'money records untouched');
select pg_temp.check((select schedule='5 16 * * *' from cron.job where jobname='bill-monthly-dues'),'existing billing job unchanged');
select pg_temp.check((select schedule='10 16 * * *' from cron.job where jobname='post-late-penalties'),'existing penalty job unchanged');
select 'ARCHIVE RETENTION, CHECKSUMS, LEASES, RLS, CUTOVER AND FINANCIAL PRESERVATION PASSED' result;
rollback;
