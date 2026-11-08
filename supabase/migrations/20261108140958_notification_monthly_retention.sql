-- Staff bell notices expire one calendar month after creation (Manila time).
-- Permanent activity_log/account_activity and all financial records are retained.
begin;
create function system_notification_private.notification_expiry(p_created_at timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select ((p_created_at at time zone 'Asia/Manila') + interval '1 month') at time zone 'Asia/Manila'
$$;
alter table public.notifications add column expires_at timestamptz;
update public.notifications set expires_at=system_notification_private.notification_expiry(created_at);
alter table public.notifications alter column expires_at set not null;
create index notifications_expiry_idx on public.notifications(expires_at);

-- A minimal private delivery key prevents old daily reports from being announced
-- again after their visible notification has been deleted. No message body or money is retained here.
create table system_notification_private.notification_delivery_keys (
 dedupe_key text primary key, first_created_at timestamptz not null
);
alter table system_notification_private.notification_delivery_keys enable row level security;
revoke all on system_notification_private.notification_delivery_keys from public,anon,authenticated;
insert into system_notification_private.notification_delivery_keys(dedupe_key,first_created_at)
 select dedupe_key,created_at from public.notifications;
create function system_notification_private.prepare_notification_retention()
returns trigger language plpgsql security definer set search_path='' as $$
declare added integer;
begin
 new.expires_at:=system_notification_private.notification_expiry(new.created_at);
 if tg_op='INSERT' then
  insert into system_notification_private.notification_delivery_keys(dedupe_key,first_created_at)
   values(new.dedupe_key,new.created_at) on conflict(dedupe_key) do nothing;
  get diagnostics added=row_count;
  if added=0 then return null; end if;
 end if;
 return new;
end $$;
create trigger zzzz_notification_retention before insert or update of created_at on public.notifications
 for each row execute function system_notification_private.prepare_notification_retention();

alter policy notifications_staff_read on public.notifications using (
 (select public.current_user_role()) in ('admin','secretary','treasurer') and expires_at>now());

create function system_notification_private.prune_notifications(p_clock timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 delete from public.notifications where expires_at<=p_clock;
 get diagnostics removed=row_count;
 -- notification_reads cascade; account_activity keeps its permanent content
 -- and only its optional notification_id becomes NULL through the existing FK.
 return removed;
end $$;
revoke all on function system_notification_private.notification_expiry(timestamptz),
 system_notification_private.prepare_notification_retention(),system_notification_private.prune_notifications(timestamptz)
 from public,anon,authenticated;
select cron.schedule('prune-expired-notifications','15 * * * *','select system_notification_private.prune_notifications()');
select system_notification_private.prune_notifications();
commit;
