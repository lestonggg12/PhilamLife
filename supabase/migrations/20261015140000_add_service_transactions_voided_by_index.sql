
-- Cover the service_transactions.voided_by foreign key.
-- Additive migration: no financial data or permissions are changed.
create index if not exists service_transactions_voided_by_idx
  on public.service_transactions (voided_by);
