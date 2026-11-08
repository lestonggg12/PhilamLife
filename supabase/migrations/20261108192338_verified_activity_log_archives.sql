-- DRAFT: requires approval to enable the additional bundled pg_net extension.
-- No existing function/view/job/money table is changed. Disabled until an Admin
-- enables it from the installed archive-aware Activity Log after storage self-test.
begin;
create extension if not exists pg_net with schema extensions;
create schema activity_archive_private;
revoke all on schema activity_archive_private from public,anon,authenticated;
create table activity_archive_private.config (
 id boolean primary key default true check(id), installed boolean not null default true,
 enabled boolean not null default false, storage_ready boolean not null default false,
 checked_at timestamptz, last_error text, storage_ceiling bigint not null default 800000000,
 project_url text not null default 'https://fjplcgszwezfgswekvep.supabase.co'
);
insert into activity_archive_private.config(id) values(true);
alter table activity_archive_private.config enable row level security;
create table public.activity_log_archives (
 id uuid primary key, period_month date not null, object_path text unique not null,
 state text not null check(state in ('pending','complete')), row_count integer not null check(row_count between 1 and 500),
 raw_sha256 text not null check(raw_sha256 ~ '^[0-9a-f]{64}$'), stored_sha256 text check(stored_sha256 ~ '^[0-9a-f]{64}$'),
 raw_bytes integer not null check(raw_bytes between 1 and 2000000), stored_bytes integer check(stored_bytes between 1 and 5000000),
 first_event timestamptz not null,last_event timestamptz not null,created_at timestamptz not null default now(),completed_at timestamptz,
 check(period_month=date_trunc('month',period_month)::date),
 check(state<>'complete' or (stored_sha256 is not null and stored_bytes is not null and completed_at is not null))
);
create index activity_log_archives_month_idx on public.activity_log_archives(period_month,created_at,id);
alter table public.activity_log_archives enable row level security;
revoke all on public.activity_log_archives from public,anon,authenticated,service_role;
grant select on public.activity_log_archives to authenticated;
create policy activity_archives_staff_read on public.activity_log_archives for select to authenticated
 using(state='complete' and (select public.current_user_role()) in ('admin','secretary','treasurer'));
create table activity_archive_private.work (
 id boolean primary key default true check(id),archive_id uuid references public.activity_log_archives(id),
 source_ids bigint[],payload text,source_sha256 text,lease uuid,leased_until timestamptz
) with (autovacuum_vacuum_scale_factor=0.05,autovacuum_vacuum_threshold=10);
insert into activity_archive_private.work(id) values(true);
alter table activity_archive_private.work enable row level security;
revoke all on all tables in schema activity_archive_private from public,anon,authenticated,service_role;
select vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,
 'philamlife_activity_archive_worker','Private scheduler token for verified Activity Log archiving')
 where not exists(select 1 from vault.secrets where name='philamlife_activity_archive_worker');

create function activity_archive_private.cutoff(p_clock timestamptz default now()) returns timestamptz
 language sql immutable set search_path='' as $$
 select (date_trunc('month',p_clock at time zone 'Asia/Manila')-interval '1 month') at time zone 'Asia/Manila'
$$;
create function activity_archive_private.event_json(p_row public.activity_log) returns jsonb
 language sql stable set search_path='' as $$
 select to_jsonb(p_row)||jsonb_build_object('id',p_row.id::text,
 'created_at',to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$$;
create function public.activity_archive_auth(p_token text) returns boolean
 language sql security definer set search_path='' as $$
 select coalesce((select c.installed and length(coalesce(p_token,''))>=64 and
 extensions.digest(p_token,'sha256')=extensions.digest(s.decrypted_secret,'sha256')
 from activity_archive_private.config c cross join vault.decrypted_secrets s
 where c.id and s.name='philamlife_activity_archive_worker'),false)
$$;
create function public.activity_archive_health(p_ok boolean) returns void
 language sql security definer set search_path='' as $$
 update activity_archive_private.config set storage_ready=p_ok,checked_at=now(),last_error=case when p_ok then null else 'storage_check_failed' end where id
$$;
create function public.activity_archive_claim() returns jsonb
 language plpgsql security definer set search_path='' as $$
declare w activity_archive_private.work%rowtype; a public.activity_log_archives%rowtype;
 month_start timestamptz; month_date date; ids bigint[]; entries jsonb; payload_text text; source_hash text;
 batch_id uuid; batch_size integer:=500; token uuid:=gen_random_uuid(); occupied numeric;
begin
 perform pg_advisory_xact_lock(741933602);
 if not (select installed and enabled and storage_ready from activity_archive_private.config where id) then return jsonb_build_object('state','disabled'); end if;
 update activity_archive_private.config set checked_at=now() where id;
 if exists(select 1 from storage.objects where metadata->>'size' is null or metadata->>'size' !~ '^[0-9]+$') then
  update activity_archive_private.config set last_error='unknown_storage_size' where id;
  return jsonb_build_object('state','paused','reason','unknown_storage_size');
 end if;
 select coalesce(sum((metadata->>'size')::numeric),0) into occupied from storage.objects;
 if occupied+5000000>(select storage_ceiling from activity_archive_private.config where id) then
  update activity_archive_private.config set last_error='storage_near_limit' where id;
  return jsonb_build_object('state','paused','reason','storage_near_limit');
 end if;
 select * into strict w from activity_archive_private.work where id for update;
 if w.archive_id is not null then
  if w.leased_until>now() then return jsonb_build_object('state','busy'); end if;
  select * into strict a from public.activity_log_archives where id=w.archive_id;
  update activity_archive_private.work set lease=token,leased_until=now()+interval '5 minutes' where id;
  return jsonb_build_object('state','work','manifest',to_jsonb(a),'lease',token,'payload',w.payload);
 end if;
 select date_trunc('month',min(created_at) at time zone 'Asia/Manila') at time zone 'Asia/Manila'
 into month_start from public.activity_log where created_at<activity_archive_private.cutoff();
 if month_start is null then
  update activity_archive_private.config set last_error=null where id;
  return jsonb_build_object('state','idle');
 end if;
 month_date:=(month_start at time zone 'Asia/Manila')::date;
 batch_id:=gen_random_uuid();
 loop
  select array_agg(l.id order by l.id),jsonb_agg(activity_archive_private.event_json(l)||
   jsonb_build_object('archived_actor',jsonb_build_object('name',coalesce(p.full_name,p.email,'Staff name unavailable'),'role',coalesce(p.role,''))) order by l.id),
   encode(extensions.digest(jsonb_agg(activity_archive_private.event_json(l) order by l.id)::text,'sha256'),'hex')
  into ids,entries,source_hash
  from (select * from public.activity_log where created_at>=month_start
    and created_at<((month_date+interval '1 month') at time zone 'Asia/Manila')
    and created_at<activity_archive_private.cutoff() order by id limit batch_size) l
  left join public.profiles p on p.id=l.user_id;
  payload_text:=jsonb_build_object('version',1,'archive_id',batch_id,'month',to_char(month_date,'YYYY-MM'),'rows',entries)::text;
  exit when octet_length(payload_text)<=2000000;
  if batch_size=1 then
   update activity_archive_private.config set last_error='oversized_event' where id;
   return jsonb_build_object('state','paused','reason','oversized_event');
  end if;
  batch_size:=greatest(1,batch_size/2);
 end loop;
 insert into public.activity_log_archives(id,period_month,object_path,state,row_count,raw_sha256,raw_bytes,first_event,last_event)
 select batch_id,month_date,to_char(month_date,'YYYY-MM')||'/'||batch_id||'.json.gz','pending',cardinality(ids),
 encode(extensions.digest(payload_text,'sha256'),'hex'),octet_length(payload_text),min(created_at),max(created_at)
 from public.activity_log where id=any(ids) returning * into a;
 update activity_archive_private.work set archive_id=batch_id,source_ids=ids,payload=payload_text,source_sha256=source_hash,
 lease=token,leased_until=now()+interval '5 minutes' where id;
 return jsonb_build_object('state','work','manifest',to_jsonb(a),'lease',token,'payload',payload_text);
end $$;
create function public.activity_archive_finish(p_archive_id uuid,p_lease uuid,p_raw_sha256 text,p_stored_sha256 text,p_stored_bytes integer)
 returns integer language plpgsql security definer set search_path='' as $$
declare w activity_archive_private.work%rowtype; a public.activity_log_archives%rowtype; fingerprint text; actual_count integer; removed integer;
begin
 perform pg_advisory_xact_lock(741933602);
 if not (select installed and enabled and storage_ready from activity_archive_private.config where id) then raise exception 'Archiving is paused'; end if;
 select * into strict w from activity_archive_private.work where id for update;
 if w.archive_id is distinct from p_archive_id or w.lease is distinct from p_lease or w.leased_until<=now() then raise exception 'Stale archive lease'; end if;
 select * into strict a from public.activity_log_archives where id=p_archive_id for update;
 if p_raw_sha256 is distinct from a.raw_sha256 or p_stored_sha256 !~ '^[0-9a-f]{64}$'
  or p_stored_sha256 is null or p_stored_bytes not between 1 and 5000000 or p_stored_bytes is null then raise exception 'Archive checksum or size does not match'; end if;
 if not exists(select 1 from storage.buckets where id='activity-log-archives' and not public)
 or not exists(select 1 from storage.objects where bucket_id='activity-log-archives' and name=a.object_path
  and metadata->>'size'=p_stored_bytes::text) then raise exception 'Private archive object is not registered'; end if;
 perform 1 from public.activity_log where id=any(w.source_ids) for update;
 select count(*),encode(extensions.digest(jsonb_agg(activity_archive_private.event_json(l) order by l.id)::text,'sha256'),'hex')
 into actual_count,fingerprint from public.activity_log l where id=any(w.source_ids);
 if actual_count<>a.row_count or fingerprint is distinct from w.source_sha256 then raise exception 'Source activity changed; original rows retained'; end if;
 if exists(select 1 from public.activity_log where id=any(w.source_ids) and (created_at>=activity_archive_private.cutoff() or created_at is null)) then raise exception 'Recent activity cannot be removed'; end if;
 if exists(select 1 from pg_constraint where contype='f' and confrelid='public.activity_log'::regclass)
 or exists(select 1 from pg_trigger where tgrelid='public.activity_log'::regclass and not tgisinternal and (tgtype::integer & 8)<>0) then raise exception 'Activity deletion dependencies require review; source records retained'; end if;
 delete from public.activity_log where id=any(w.source_ids);
 get diagnostics removed=row_count;
 if removed<>a.row_count then raise exception 'Source deletion count does not match archive'; end if;
 update public.activity_log_archives set state='complete',stored_sha256=p_stored_sha256,stored_bytes=p_stored_bytes,completed_at=now() where id=p_archive_id;
 update activity_archive_private.work set archive_id=null,source_ids=null,payload=null,source_sha256=null,lease=null,leased_until=null where id;
 update activity_archive_private.config set last_error=null,checked_at=now() where id;
 return removed;
end $$;
create function public.activity_archive_fail(p_archive_id uuid,p_lease uuid,p_code text) returns void
 language plpgsql security definer set search_path='' as $$
begin
 if p_code not in ('upload_failed','download_failed','checksum_mismatch','worker_error','storage_check_failed') then p_code:='worker_error'; end if;
 if exists(select 1 from activity_archive_private.work where id and archive_id=p_archive_id and lease=p_lease) then
  update activity_archive_private.config set last_error=p_code,checked_at=now() where id;
  update activity_archive_private.work set leased_until=now() where id;
 end if;
end $$;
create function activity_archive_private.enqueue(p_mode text default 'archive') returns bigint
 language plpgsql security definer set search_path='' as $$
declare request_id bigint; token text; base_url text;
begin
 if p_mode not in ('archive','self_test') then raise exception 'Invalid archive request'; end if;
 if not (select installed and (enabled or p_mode='self_test') from activity_archive_private.config where id) then return null; end if;
 select decrypted_secret into strict token from vault.decrypted_secrets where name='philamlife_activity_archive_worker';
 select project_url into strict base_url from activity_archive_private.config where id;
 select net.http_post(url:=base_url||'/functions/v1/archive-activity-logs',
 headers:=jsonb_build_object('Content-Type','application/json','x-archive-worker-token',token),
 body:=jsonb_build_object('mode',p_mode),timeout_milliseconds:=60000) into request_id;
 return request_id;
end $$;
create function public.activity_archive_status() returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or coalesce(public.current_user_role(),'') not in ('admin','secretary','treasurer') then raise exception 'An active staff account is required' using errcode='42501'; end if;
 return (select jsonb_build_object('installed',installed,'enabled',enabled,'storage_ready',storage_ready,'checked_at',checked_at,'last_error',last_error,
 'can_manage',public.current_user_role()='admin','cutoff',activity_archive_private.cutoff(),
 'archived_records',(select coalesce(sum(row_count),0) from public.activity_log_archives where state='complete'),
 'archive_bytes',(select coalesce(sum(stored_bytes),0) from public.activity_log_archives where state='complete'),
 'pending_records',(select count(*) from public.activity_log where created_at<activity_archive_private.cutoff()))
 from activity_archive_private.config where id);
end $$;
create function public.prepare_activity_archives() returns bigint
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.current_user_role() is distinct from 'admin' then raise exception 'Only Admin may prepare archiving' using errcode='42501'; end if;
 perform public.write_required_balance_audit('Activity Archive Check Requested','Requested verification of private archive storage. Activity records remain available.');
 return activity_archive_private.enqueue('self_test');
end $$;
create function public.set_activity_archive_enabled(p_enabled boolean,p_reader_version integer) returns void
 language plpgsql security definer set search_path='' as $$
declare was_enabled boolean;
begin
 if auth.uid() is null or public.current_user_role() is distinct from 'admin' then raise exception 'Only Admin may change archiving' using errcode='42501'; end if;
 if p_enabled is null or p_reader_version is distinct from 1 then raise exception 'Update the Activity Log reader before enabling archiving'; end if;
 select enabled into was_enabled from activity_archive_private.config where id for update;
 if p_enabled and not (select installed and storage_ready from activity_archive_private.config where id) then raise exception 'Archive storage verification is not ready'; end if;
 if was_enabled=p_enabled then return; end if;
 update activity_archive_private.config set enabled=p_enabled where id;
 perform public.write_required_balance_audit(case when p_enabled then 'Activity Archive Enabled' else 'Activity Archive Paused' end,
 case when p_enabled then 'Enabled verified archiving of older activity. The current and previous calendar months remain in the main Activity Log; older records stay available in private archives.'
 else 'Paused automatic activity archiving. Existing records and archives remain available.' end);
 if p_enabled then perform activity_archive_private.enqueue(); end if;
end $$;
-- Worker-only RPCs; no browser may claim or finalize a batch or attest its health.
revoke all on function public.activity_archive_auth(text),public.activity_archive_health(boolean),public.activity_archive_claim(),
 public.activity_archive_finish(uuid,uuid,text,text,integer),public.activity_archive_fail(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.activity_archive_auth(text),public.activity_archive_health(boolean),public.activity_archive_claim(),
 public.activity_archive_finish(uuid,uuid,text,text,integer),public.activity_archive_fail(uuid,uuid,text) to service_role;
revoke all on function public.activity_archive_status(),public.prepare_activity_archives(),public.set_activity_archive_enabled(boolean,integer) from public,anon;
grant execute on function public.activity_archive_status(),public.prepare_activity_archives(),public.set_activity_archive_enabled(boolean,integer) to authenticated;
revoke all on all functions in schema activity_archive_private from public,anon,authenticated;
-- The worker creates a PRIVATE bucket through the Storage API, never SQL writes to storage.objects.
create policy activity_archives_objects_staff_read on storage.objects for select to authenticated
 using(bucket_id='activity-log-archives' and (select public.current_user_role()) in ('admin','secretary','treasurer')
 and exists(select 1 from public.activity_log_archives a where a.state='complete' and a.object_path=storage.objects.name));
create policy activity_archives_objects_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'activity-log-archives' or ((select public.current_user_role()) in ('admin','secretary','treasurer')
 and exists(select 1 from public.activity_log_archives a where a.state='complete' and a.object_path=storage.objects.name)));
create policy activity_archives_objects_anon_guard on storage.objects as restrictive for select to anon
 using(bucket_id<>'activity-log-archives');
create policy activity_archives_objects_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'activity-log-archives');
create policy activity_archives_objects_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'activity-log-archives') with check(bucket_id<>'activity-log-archives');
create policy activity_archives_objects_delete_guard on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'activity-log-archives');
select cron.schedule('archive-old-activity-logs','*/15 * * * *','select activity_archive_private.enqueue()');
commit;
