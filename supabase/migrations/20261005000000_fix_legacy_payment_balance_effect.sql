-- Legacy payments (recorded before charge types existed) have balance_effect = 0 even
-- though each one reduced the homeowner's balance by its full amount. Voiding one of
-- them would therefore add back PHP 0 instead of the amount paid.
-- This sets balance_effect to what the payment really did: previous_balance - remaining_balance.
-- It does NOT change any homeowner's current_balance. Guards abort the whole change if
-- anything unexpected happens.
do $$
declare
  bal_before numeric;
  bal_after numeric;
  n_updated int;
begin
  select coalesce(sum(current_balance), 0) into bal_before from public.properties;

  update public.payments
     set balance_effect = previous_balance - remaining_balance
   where charge_type is null
     and status <> 'Voided'
     and property_id is not null
     and balance_effect = 0
     and amount_paid > 0
     and abs((previous_balance - remaining_balance) - amount_paid) < 0.005;
  get diagnostics n_updated = row_count;

  select coalesce(sum(current_balance), 0) into bal_after from public.properties;

  if n_updated <> 9 then
    raise exception 'Expected to correct 9 legacy payments but found %; nothing was changed.', n_updated;
  end if;
  if bal_before <> bal_after then
    raise exception 'Homeowner balances changed unexpectedly; nothing was changed.';
  end if;
end $$;