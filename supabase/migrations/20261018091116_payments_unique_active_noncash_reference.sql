-- Backstop for prevent_duplicate_non_cash_payment_reference trigger.
-- Payments 781 and 782 (ref 123456) were recorded before the trigger existed; kept untouched as legacy records.
create unique index if not exists payments_unique_active_noncash_reference
on public.payments (lower(regexp_replace(btrim(reference_number), '[[:space:]]+', '', 'g')))
where status <> 'Voided'
  and payment_method is not null
  and lower(btrim(payment_method)) <> 'cash'
  and btrim(coalesce(reference_number, '')) <> ''
  and id not in (781, 782);