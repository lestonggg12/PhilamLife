-- Secretary audit 4/5/6: confirmed writes, active service accounts and retryable deletion.
-- No historic rows or Storage objects are deleted by this installation.
begin;
set local lock_timeout='5s';

-- A new receipt locks the account until commit, serializing with transfers.
-- Existing partial-service settlements still follow their original receipt.
CREATE OR REPLACE FUNCTION public.prepare_service_transaction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  svc public.amenity_services%rowtype;
  prop public.properties%rowtype;
begin
  -- Balance payments are handled by check_service_balance_payment(); server-side writes skip this.
  if new.balance_of is not null or auth.uid() is null then
    return new;
  end if;

  select * into svc from public.amenity_services where id = new.service_id;
  if not found then raise exception 'Service not found.'; end if;
  if not svc.is_active then raise exception '% is not active.', svc.name; end if;

  if new.property_id is null then raise exception 'Select a homeowner.'; end if;
  select * into prop from public.properties where id = new.property_id for update;
  if not found then raise exception 'Homeowner not found.'; end if;
  if prop.homeowner_status is distinct from 'active' then
    raise exception using errcode='22023',message='New service receipts require an active homeowner account. Refresh and select the current owner.';
  end if;

  new.quantity := greatest(coalesce(new.quantity, 1), 1);
  new.unit_rate := svc.rate;
  new.amount_due := round(svc.rate * new.quantity, 2);
  if new.amount_due <= 0 then raise exception '% has no rate set.', svc.name; end if;

  new.service_name := svc.name;
  new.customer_name := coalesce(nullif(btrim(prop.homeowner_name), ''), new.customer_name);
  new.block_name := prop.block;
  new.lot_number := prop.lot_number::text;

  if new.amount_paid is null or new.amount_paid <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;
  if new.amount_paid > new.amount_due then
    raise exception 'Amount received is more than the amount due of PHP %. Return the extra as change.', new.amount_due;
  end if;

  new.payment_status := case when new.amount_paid >= new.amount_due then 'paid' else 'partial' end;
  new.voided_at := null;
  new.voided_by := null;
  new.void_reason := null;
  return new;
end $function$;

revoke all on function public.prepare_service_transaction() from public,anon,authenticated;

alter table public.documents
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_requested_by uuid references public.profiles(id) on delete restrict;
create index if not exists documents_deletion_requested_by_idx on public.documents(deletion_requested_by);
do $$begin
  if not exists(select 1 from pg_constraint where conrelid='public.documents'::regclass and conname='documents_deletion_marker_pair') then
    alter table public.documents add constraint documents_deletion_marker_pair
      check((deletion_requested_at is null)=(deletion_requested_by is null));
  end if;
end$$;

-- Only the protocol may mark/finalize a deletion. Existing roles still upload,
-- read and request deletion exactly as before; there is no new delete role.
revoke update,delete on public.documents from public,anon,authenticated;
drop policy if exists "Admin and Secretary can delete documents" on public.documents;
alter policy "Secretary can upload documents" on public.documents with check (
  uploaded_by=(select auth.uid()) and (select public.current_user_role())='secretary'
  and deletion_requested_at is null and deletion_requested_by is null
);

create or replace function public.begin_document_deletion(p_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare doc public.documents%rowtype;
begin
  if auth.uid() is null or coalesce(public.current_user_role(),'') not in ('admin','secretary') then
    raise exception using errcode='42501',message='Only an active Admin or Secretary can delete documents.';
  end if;
  if p_document_id is null then raise exception 'Choose a document.'; end if;
  select * into doc from public.documents where id=p_document_id for update;
  if not found then return jsonb_build_object('already_deleted',true); end if;
  if doc.deletion_requested_at is null then
    update public.documents set deletion_requested_at=now(),deletion_requested_by=auth.uid()
      where id=doc.id returning * into doc;
    if not found or doc.deletion_requested_at is null then raise exception 'Could not confirm the deletion request.'; end if;
  end if;
  return jsonb_build_object('already_deleted',false,'document',to_jsonb(doc));
end;
$$;
revoke all on function public.begin_document_deletion(uuid) from public,anon;
grant execute on function public.begin_document_deletion(uuid) to authenticated;

create or replace function public.finish_document_deletion(p_document_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare doc public.documents%rowtype; actor_name text; removed integer;
begin
  if auth.uid() is null or coalesce(public.current_user_role(),'') not in ('admin','secretary') then
    raise exception using errcode='42501',message='Only an active Admin or Secretary can delete documents.';
  end if;
  if p_document_id is null then raise exception 'Choose a document.'; end if;
  select * into doc from public.documents where id=p_document_id for update;
  if not found then return true; end if;
  if doc.deletion_requested_at is null then raise exception 'Start the document deletion before finishing it.'; end if;
  -- READ Storage metadata only. Actual bytes are removed by Storage API.
  if exists(select 1 from storage.objects where bucket_id='hoa-documents' and name=doc.storage_path) then
    raise exception using errcode='55000',message='The file has not been removed yet. Retry deletion.';
  end if;
  select coalesce(nullif(btrim(full_name),''),email,'Staff user') into actor_name from public.profiles where id=auth.uid();
  perform public.write_required_balance_audit('Document Deleted',
    doc.title||' — '||doc.original_file_name||' (by '||actor_name||')');
  delete from public.documents where id=doc.id;
  get diagnostics removed=row_count;
  if removed<>1 then raise exception 'Document removal could not be confirmed. Retry deletion.'; end if;
  return true;
end;
$$;
revoke all on function public.finish_document_deletion(uuid) from public,anon;
grant execute on function public.finish_document_deletion(uuid) to authenticated;

-- Require a durable marker before removing a registered file. Preserve cleanup
-- of a Secretary's own orphan upload if its metadata INSERT failed.
alter policy "Admin and Secretary can delete HOA document files" on storage.objects using (
  bucket_id='hoa-documents' and (storage.foldername(name))[1]='documents'
  and (select public.current_user_role()) in ('admin','secretary')
  and (
    exists(select 1 from public.documents d where d.storage_path=storage.objects.name and d.deletion_requested_at is not null)
    or (owner_id=(select auth.uid()::text) and not exists(select 1 from public.documents d where d.storage_path=storage.objects.name))
  )
);
-- Fresh uploads use new UUID paths. Do not recreate a file at a path already
-- claimed by an active or pending document while deletion is being finalized.
alter policy "Secretary can upload HOA document files" on storage.objects with check (
  bucket_id='hoa-documents' and (storage.foldername(name))[1]='documents'
  and (select public.current_user_role())='secretary'
  and not exists(select 1 from public.documents d where d.storage_path=storage.objects.name)
);

notify pgrst,'reload schema';
commit;
