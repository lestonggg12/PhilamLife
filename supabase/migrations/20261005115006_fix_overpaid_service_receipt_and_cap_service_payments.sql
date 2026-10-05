-- Extra money handed over for a service is change, never revenue and never credit
-- (credit is only added by paying Association Dues). One test receipt, SR-2026-000008,
-- recorded PHP 500 paid for a PHP 50 charge. Record what the association really keeps
-- (the amount due) and keep a note of the change returned.
-- Then make the database reject any future service payment above the amount due.
-- Services do not touch homeowner balances, so no balance changes. Guards abort everything
-- if anything unexpected is found.
do $$
declare
  n_updated int;
  n_overpaid int;
  rows_before bigint;
  rows_after bigint;
begin
  select count(*) into rows_before from public.service_transactions;

  update public.service_transactions
     set amount_paid = amount_due,
         notes = trim(both ' ' from coalesce(notes, '') || ' [Corrected: PHP 500.00 handed over, PHP 450.00 returned as change; amount kept = PHP 50.00]')
   where receipt_number = 'SR-2026-000008'
     and amount_due = 50.00
     and amount_paid = 500.00
     and payment_status = 'paid';
  get diagnostics n_updated = row_count;

  if n_updated <> 1 then
    raise exception 'Expected to correct exactly 1 receipt but found %; nothing was changed.', n_updated;
  end if;

  select count(*) into n_overpaid from public.service_transactions where amount_paid > amount_due;
  if n_overpaid <> 0 then
    raise exception 'Found % other overpaid service receipts; nothing was changed.', n_overpaid;
  end if;

  select count(*) into rows_after from public.service_transactions;
  if rows_before <> rows_after then
    raise exception 'Row count changed unexpectedly; nothing was changed.';
  end if;
end $$;

alter table public.service_transactions
  add constraint service_transactions_paid_not_over_due
  check (amount_paid <= amount_due);