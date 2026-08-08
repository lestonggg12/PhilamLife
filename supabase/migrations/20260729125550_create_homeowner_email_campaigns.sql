create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (length(btrim(subject)) between 1 and 200),
  message text not null check (length(btrim(message)) between 1 and 5000),
  storage_path text not null unique
    check (storage_path like 'email-campaigns/%'),
  original_file_name text not null
    check (length(btrim(original_file_name)) between 1 and 255),
  file_size bigint not null
    check (file_size > 0 and file_size <= 10485760),
  status text not null default 'sending'
    check (status in ('sending', 'completed', 'partial', 'failed')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  created_by uuid not null references auth.users(id),
  created_by_name text not null
    check (length(btrim(created_by_name)) between 1 and 160),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.email_campaigns is
  'Auditable PDF email campaigns sent to homeowner contact addresses.';

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null
    references public.email_campaigns(id) on delete restrict,
  property_id bigint references public.properties(id) on delete set null,
  homeowner_name text not null
    check (length(btrim(homeowner_name)) between 1 and 160),
  recipient_email text not null
    check (length(btrim(recipient_email)) between 3 and 320),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  resend_email_id text,
  error_message text check (
    error_message is null or length(error_message) <= 1000
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, recipient_email)
);

comment on table public.email_deliveries is
  'Per-recipient delivery results for homeowner PDF campaigns.';

create index if not exists email_campaigns_created_at_idx
  on public.email_campaigns (created_at desc);

create index if not exists email_campaigns_created_by_idx
  on public.email_campaigns (created_by);

create index if not exists email_deliveries_campaign_status_idx
  on public.email_deliveries (campaign_id, status);

create index if not exists email_deliveries_property_id_idx
  on public.email_deliveries (property_id);

alter table public.email_campaigns enable row level security;
alter table public.email_deliveries enable row level security;

revoke all on table public.email_campaigns from anon, authenticated;
revoke all on table public.email_deliveries from anon, authenticated;
grant select on table public.email_campaigns to authenticated;
grant select on table public.email_deliveries to authenticated;

drop policy if exists "Secretary can view email campaigns"
  on public.email_campaigns;
create policy "Secretary can view email campaigns"
  on public.email_campaigns
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'secretary'
  );

drop policy if exists "Secretary can view email deliveries"
  on public.email_deliveries;
create policy "Secretary can view email deliveries"
  on public.email_deliveries
  for select
  to authenticated
  using (
    (select public.current_user_role()) = 'secretary'
  );

drop policy if exists "Secretary can upload email campaign PDFs"
  on storage.objects;
create policy "Secretary can upload email campaign PDFs"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hoa-documents'
    and (storage.foldername(name))[1] = 'email-campaigns'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.current_user_role()) = 'secretary'
  );

drop policy if exists "Secretary can read email campaign PDFs"
  on storage.objects;
create policy "Secretary can read email campaign PDFs"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hoa-documents'
    and (storage.foldername(name))[1] = 'email-campaigns'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.current_user_role()) = 'secretary'
  );

drop policy if exists "Secretary can remove unsent email campaign PDFs"
  on storage.objects;
create policy "Secretary can remove unsent email campaign PDFs"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hoa-documents'
    and (storage.foldername(name))[1] = 'email-campaigns'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and (select public.current_user_role()) = 'secretary'
  );
