create or replace function public.void_service_receipt(
  p_receipt_id uuid,
  p_reason text
)
returns public.service_transactions
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  target public.service_transactions%rowtype;
  updated public.service_transactions%rowtype;
  parent_id uuid;
  reason_text text;
begin
  if auth.uid() is null
     or coalesce(public.current_user_role(), '') not in
       ('secretary', 'treasurer') then
    raise exception using
      errcode = '42501',
      message = 'Only active Secretary and Treasurer users may void service receipts.';
  end if;

  reason_text := btrim(coalesce(p_reason, ''));

  if char_length(reason_text) < 5
     or char_length(reason_text) > 500 then
    raise exception using
      errcode = '22023',
      message = 'Enter a void reason between 5 and 500 characters.';
  end if;

  select s.balance_of into parent_id
  from public.service_transactions s
  where s.id = p_receipt_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Service receipt not found.';
  end if;

  -- Serialize against concurrent balance collections.
  if parent_id is not null then
    perform 1
    from public.service_transactions s
    where s.id = parent_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'Original service receipt not found.';
    end if;
  end if;

  select * into target
  from public.service_transactions s
  where s.id = p_receipt_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Service receipt not found.';
  end if;

  if target.payment_status = 'voided' then
    raise exception using
      errcode = '22023',
      message = 'This receipt is already voided.';
  end if;

  -- Never strand an active settlement receipt.
  if target.balance_of is null and exists (
    select 1
    from public.service_transactions child
    where child.balance_of = target.id
      and child.payment_status <> 'voided'
  ) then
    raise exception using
      errcode = '23514',
      message = 'Void the active balance-collection receipts first, then void the original receipt.';
  end if;

  update public.service_transactions s
  set payment_status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = reason_text
  where s.id = target.id
  returning s.* into updated;

  return updated;
end;
$fn$;

revoke all on function public.void_service_receipt(uuid,text)
from public, anon;

grant execute on function public.void_service_receipt(uuid,text)
to authenticated;