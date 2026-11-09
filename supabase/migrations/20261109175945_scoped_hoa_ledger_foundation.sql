-- Review draft. Install only in a disposable or staging database.
-- This migration creates a new stream. Existing financial writers and data are untouched.
begin;

create schema hoa_ledger;
revoke all on schema hoa_ledger from public, anon, authenticated, service_role;
grant usage on schema hoa_ledger to authenticated;

create table hoa_ledger.entries (
  entry_id bigint generated always as identity (cache 1) primary key,
  property_id bigint not null references public.properties(id) on delete restrict,
  scope smallint not null check (scope between 1 and 4),
  entry_kind smallint not null check (entry_kind between 1 and 8),
  status smallint not null default 1 check (status in (1, 2, 3)),
  created_at timestamptz not null default clock_timestamp(),
  amount_delta numeric(12,2) not null check (amount_delta <> 'NaN'::numeric),
  related_entry_id bigint references hoa_ledger.entries(entry_id) on delete restrict,
  source_key text collate "C" not null unique check (octet_length(source_key) between 1 and 128),
  document_ref text,
  memo text,
  historical_as_of date,
  recorded_by uuid,
  check (related_entry_id < entry_id),
  check (
    (scope = 1 and entry_kind between 1 and 6)
    or (scope in (2, 3, 4) and entry_kind in (5, 7, 8))
  ),
  check (
    (status in (2, 3) and related_entry_id is not null
      and nullif(btrim(memo), '') is not null)
    or (status = 1 and amount_delta <> 0 and
      ((entry_kind = 6 and related_entry_id is not null)
        or (entry_kind <> 6 and related_entry_id is null)) and
      (entry_kind in (4, 5)
        or (entry_kind in (1, 3, 6, 7) and amount_delta > 0)
        or (entry_kind in (2, 8) and amount_delta < 0)))
  )
);

comment on column hoa_ledger.entries.scope is
  '1 dues receivables, 2 construction bonds, 3 security deposits, 4 escrow';
comment on column hoa_ledger.entries.entry_kind is
  '1 charge, 2 payment, 3 penalty, 4 adjustment, 5 opening, 6 payment release, 7 funds received, 8 funds returned';
comment on column hoa_ledger.entries.status is
  '1 posting, 2 void event, 3 cancellation event. Effective status of an original is derived from its terminal event.';
comment on column hoa_ledger.entries.historical_as_of is
  'Descriptive metadata only. Never controls posting sequence or the statement period.';

create index entries_property_scope_sequence_idx
  on hoa_ledger.entries (property_id, scope, entry_id);

create index entries_posted_payment_release_idx
  on hoa_ledger.entries (related_entry_id)
  where status = 1 and entry_kind = 6;

create unique index entries_one_terminal_event_idx
  on hoa_ledger.entries (related_entry_id)
  where status in (2, 3);

-- One private bucket can be configured by the Storage rollout.
-- Only its object key is stored here. Duplicate linkage to the same entry is blocked.
create table hoa_ledger.entry_documents (
  entry_id bigint not null references hoa_ledger.entries(entry_id) on delete restrict,
  object_key text not null check (octet_length(object_key) between 1 and 512),
  primary key (entry_id, object_key)
);

revoke all on all tables in schema hoa_ledger from public, anon, authenticated, service_role;
revoke all on all sequences in schema hoa_ledger from public, anon, authenticated, service_role;
alter table hoa_ledger.entries enable row level security;
alter table hoa_ledger.entry_documents enable row level security;

create policy entries_staff_read on hoa_ledger.entries
  for select to authenticated
  using ((select public.current_user_role()) in ('admin', 'secretary', 'treasurer'));
create policy entry_documents_staff_read on hoa_ledger.entry_documents
  for select to authenticated
  using ((select public.current_user_role()) in ('admin', 'secretary', 'treasurer'));
grant select on hoa_ledger.entries, hoa_ledger.entry_documents to authenticated;

create function hoa_ledger.reject_entry_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Ledger entries are immutable. Post a linked correction.' using errcode = '55000';
end;
$$;

revoke all on function hoa_ledger.reject_entry_mutation()
  from public, anon, authenticated, service_role;

create trigger entries_append_only
  before update or delete or truncate on hoa_ledger.entries
  for each statement execute function hoa_ledger.reject_entry_mutation();

-- Internal writer. The existing authorized database transaction should call this
-- after validating the actor, source, amount, and any refund or escrow rules.
create function hoa_ledger.append_entry(
  p_property_id bigint,
  p_scope smallint,
  p_entry_kind smallint,
  p_source_key text,
  p_amount_delta numeric default null,
  p_status smallint default 1,
  p_related_entry_id bigint default null,
  p_document_ref text default null,
  p_memo text default null,
  p_historical_as_of date default null,
  p_recorded_by uuid default null
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_existing hoa_ledger.entries%rowtype;
  v_original hoa_ledger.entries%rowtype;
  v_release_total numeric;
  v_amount_delta numeric := p_amount_delta;
  v_id bigint;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Ledger append requires READ COMMITTED';
  end if;

  if p_status in (2, 3) and p_amount_delta is not null then
    raise exception 'Void and cancellation amounts are derived from the original posting';
  end if;

  if p_status = 1 and (
    p_amount_delta is null or p_amount_delta = 'NaN'::numeric
    or abs(p_amount_delta) > 9999999999.99
    or trunc(p_amount_delta, 2) <> p_amount_delta
  ) then
    raise exception 'Posting amount must be finite and within the two-decimal money range';
  end if;

  -- Serialize writers for this lot before identity allocation. Keep this lock
  -- through transaction end. Multi-lot writers must acquire locks in ID order.
  perform 1 from public.properties where id = p_property_id for no key update;
  if not found then
    raise exception 'Unknown ledger property %', p_property_id using errcode = '23503';
  end if;

  select * into v_existing from hoa_ledger.entries where source_key = p_source_key;
  if found then
    if (v_existing.property_id, v_existing.scope, v_existing.entry_kind,
        v_existing.status, v_existing.related_entry_id, v_existing.document_ref,
        v_existing.memo, v_existing.historical_as_of, v_existing.recorded_by)
      is distinct from
       (p_property_id, p_scope, p_entry_kind, p_status, p_related_entry_id,
        p_document_ref, p_memo, p_historical_as_of, p_recorded_by)
      or (p_status = 1 and v_existing.amount_delta is distinct from p_amount_delta)
    then
      raise exception 'Ledger source key already belongs to a different posting' using errcode = '23505';
    end if;
    return v_existing.entry_id;
  end if;

  if p_related_entry_id is not null then
    select * into v_original from hoa_ledger.entries where entry_id = p_related_entry_id;
    if not found or v_original.property_id <> p_property_id
      or v_original.scope <> p_scope or v_original.status <> 1
      or v_original.related_entry_id is not null
    then
      raise exception 'Correction requires an original posting in the same property and scope';
    end if;

    if exists (
      select 1 from hoa_ledger.entries
      where related_entry_id = p_related_entry_id and status in (2, 3)
    ) then
      raise exception 'Original ledger entry is already voided or cancelled';
    end if;

    if v_original.entry_kind = 2 then
      select coalesce(sum(amount_delta), 0) into v_release_total
      from hoa_ledger.entries
      where related_entry_id = p_related_entry_id and status = 1 and entry_kind = 6;
    else
      v_release_total := 0;
    end if;

    if p_status in (2, 3) then
      if p_entry_kind is distinct from v_original.entry_kind then
        raise exception 'Void or cancellation kind must match the original posting';
      end if;
      v_amount_delta := -(v_original.amount_delta + v_release_total);
    elsif p_entry_kind = 6 and p_status = 1 then
      if v_original.entry_kind <> 2
        or v_release_total + p_amount_delta > -v_original.amount_delta
      then
        raise exception 'Payment release exceeds the remaining payment effect or has an invalid parent';
      end if;
    else
      raise exception 'Only releases, voids, and cancellations may reference an original posting';
    end if;
  end if;

  insert into hoa_ledger.entries (
    property_id, scope, entry_kind, status, amount_delta, related_entry_id,
    source_key, document_ref, memo, historical_as_of, recorded_by
  ) values (
    p_property_id, p_scope, p_entry_kind, p_status, v_amount_delta, p_related_entry_id,
    p_source_key, p_document_ref, p_memo, p_historical_as_of, p_recorded_by
  ) returning entry_id into v_id;
  return v_id;
end;
$$;

revoke all on function hoa_ledger.append_entry(
  bigint, smallint, smallint, text, numeric, smallint, bigint, text, text, date, uuid
) from public, anon, authenticated, service_role;

-- Current clean statement. Filter out the whole voided/cancelled group before
-- applying the window, including releases tied to a voided payment.
create view public.hoa_dues_statement with (security_invoker = true) as
select e.entry_id, e.property_id, e.created_at, e.entry_kind, e.document_ref,
       e.memo, e.historical_as_of, e.related_entry_id, e.amount_delta,
       sum(e.amount_delta) over (
         partition by e.property_id order by e.entry_id
         rows between unbounded preceding and current row
       ) as running_balance
from hoa_ledger.entries as e
where e.scope = 1 and e.status = 1 and e.amount_delta <> 0
  and not exists (
    select 1 from hoa_ledger.entries as v
    where v.related_entry_id = coalesce(e.related_entry_id, e.entry_id)
      and v.status in (2, 3)
  );

-- Audit history. Scope 1 is dues AR. Positive balances in scopes 2–4 are funds held.
-- Zero-value terminal events can appear here after a payment was fully released.
create view public.hoa_ledger_audit with (security_invoker = true) as
select e.entry_id, e.property_id, e.scope, e.created_at, e.entry_kind,
       e.status, e.document_ref, e.memo, e.historical_as_of,
       e.related_entry_id, e.source_key, e.recorded_by, e.amount_delta,
       sum(e.amount_delta) over (
         partition by e.property_id, e.scope order by e.entry_id
         rows between unbounded preceding and current row
       ) as running_balance
from hoa_ledger.entries as e;

revoke all on public.hoa_dues_statement, public.hoa_ledger_audit
  from public, anon, authenticated, service_role;
grant select on public.hoa_dues_statement, public.hoa_ledger_audit to authenticated;

commit;

-- Example current dues statement. Bind $1 to public.properties.id.
-- select * from public.hoa_dues_statement
-- where property_id = $1
-- order by entry_id;

-- Example authenticated staff audit for one scope through a recorded cutoff.
-- Capture the cutoff entry ID when closing a period or generating a reproducible
-- audit export. The saved cutoff is a sequence position, with no saved balance.
-- select * from public.hoa_ledger_audit
-- where property_id = $1 and scope = $2 and entry_id <= $3
-- order by entry_id;

-- Rollout order
-- 1. Map every legacy source to a scope using verified source types and references.
--    Reconcile AR and each holdings scope separately. Resolve ambiguous records first.
-- 2. At the agreed cutover, carry verified balances forward once per property and
--    scope, or replay reliably sequenced history. Never seed and replay the same
--    economic activity. Keep legacy history accessible when using openings.
-- 3. Call the internal append function from the same transaction as the authorized
--    source write. Use deterministic source keys and lock multiple lots in ID order.
--    Define holding release and refund authorization per underlying obligation.
-- 4. Compare parallel results and reconcile discrepancies before switching readers.
--    Keep the existing stored-balance fields until all dependent RPCs, reports,
--    allocations, billing and penalty workflows have passed cutover validation.
