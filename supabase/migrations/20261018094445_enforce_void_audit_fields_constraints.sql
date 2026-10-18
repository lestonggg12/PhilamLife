-- A voided record must always carry who, when and why; an active record must carry none.
-- Enforced at table level so it also covers service-role and manual SQL paths.
alter table public.payments
  add constraint payments_void_audit_check check (
    (status = 'Voided' and voided_at is not null and voided_by is not null and btrim(coalesce(void_reason, '')) <> '')
    or (status <> 'Voided' and voided_at is null and voided_by is null and void_reason is null)
  );

alter table public.service_transactions
  add constraint service_transactions_void_audit_check check (
    (payment_status = 'voided' and voided_at is not null and voided_by is not null and btrim(coalesce(void_reason, '')) <> '')
    or (payment_status <> 'voided' and voided_at is null and voided_by is null and void_reason is null)
  );