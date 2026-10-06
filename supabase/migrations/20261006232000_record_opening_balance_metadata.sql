-- Document legacy balances without creating unsupported synthetic charges.
alter table public.properties
  add column if not exists opening_balance numeric(12, 2),
  add column if not exists opening_balance_as_of date,
  add column if not exists opening_balance_note text;

update public.properties
set opening_balance = values.opening_balance,
    opening_balance_as_of = date '2026-10-01',
    opening_balance_note = 'Inferred from stored balance and visible transaction history; source records unavailable.'
from (values
  (1, 3000.00::numeric),
  (2, 1350.00::numeric),
  (3, 2999.99::numeric),
  (4, 5000.00::numeric),
  (7, 1900.00::numeric),
  (10, 10000.00::numeric),
  (11, 5000.00::numeric)
) as values(property_id, opening_balance)
where public.properties.id = values.property_id
  and public.properties.opening_balance is null;

comment on column public.properties.opening_balance is
  'Documented or inferred balance carried into the visible ledger history; does not alter current_balance.';
comment on column public.properties.opening_balance_as_of is
  'Date at which opening_balance was established.';
comment on column public.properties.opening_balance_note is
  'Evidence or qualification for the opening balance.';
