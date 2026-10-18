create or replace function public.prevent_duplicate_non_cash_payment_reference()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  normalized_reference text;
begin
  if new.payment_method is null or lower(btrim(new.payment_method)) = 'cash' then
    return new;
  end if;

  if new.status is not distinct from 'Voided' then
    return new;
  end if;

  normalized_reference := lower(regexp_replace(btrim(coalesce(new.reference_number, '')), '[[:space:]]+', '', 'g'));

  if normalized_reference = '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('payment-reference:' || normalized_reference));

  if exists (
    select 1
    from public.payments p
    where p.id is distinct from new.id
      and p.status is distinct from 'Voided'
      and p.payment_method is not null
      and lower(btrim(p.payment_method)) <> 'cash'
      and lower(regexp_replace(btrim(coalesce(p.reference_number, '')), '[[:space:]]+', '', 'g')) = normalized_reference
  ) then
    raise exception using
      errcode = '23505',
      message = 'This reference number has already been used for a non-cash payment. Verify it or ask an administrator to review it.';
  end if;

  return new;
end;
$function$;