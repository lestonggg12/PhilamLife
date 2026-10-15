create or replace function public.prevent_duplicate_non_cash_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  normalized_reference text;
begin
  if new.payment_method is null or lower(btrim(new.payment_method)) = 'cash' then
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

revoke execute on function public.prevent_duplicate_non_cash_payment_reference() from public, anon, authenticated;

drop trigger if exists prevent_duplicate_non_cash_payment_reference on public.payments;

create trigger prevent_duplicate_non_cash_payment_reference
before insert or update of payment_method, reference_number
on public.payments
for each row
execute function public.prevent_duplicate_non_cash_payment_reference();;
