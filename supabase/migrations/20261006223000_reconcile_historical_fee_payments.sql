-- Reconcile the six historical fee receipts confirmed from the original receipts.
-- This is intentionally idempotent and aborts if live payment data differs.
-- Payments 35 and 36 apply PHP 1,000 to the fee; the remaining PHP 1,500
-- remains unallocated, matching the receipts' unchanged PHP 1,000 balance.
do $$
declare
  rec record;
  payment_row public.payments%rowtype;
  charge_id uuid;
  applied numeric(12,2);
  inserted_charge boolean;
  before_total numeric;
  after_total numeric;
begin
  select coalesce(sum(current_balance), 0) into before_total
  from public.properties;

  for rec in
    select *
    from (values
      (35::bigint, 4::bigint, 'Sticker / ID Fee'::text, 'Sticker / ID Fee - id with advance payment'::text, 1000.00::numeric, 1500.00::numeric),
      (36::bigint, 9::bigint, 'Sticker / ID Fee'::text, 'Sticker / ID Fee - id with advance payment'::text, 1000.00::numeric, 1500.00::numeric),
      (753::bigint, 10::bigint, 'Sticker / ID Fee'::text, 'Sticker / ID Fee - Bayad'::text, 150.00::numeric, 0.00::numeric),
      (754::bigint, 11::bigint, 'Document / Certification Fee'::text, 'Document / Certification Fee - dad'::text, 450.00::numeric, 0.00::numeric),
      (755::bigint, 2::bigint, 'Special Assessment'::text, 'Special Assessment - dad'::text, 345.00::numeric, 0.00::numeric),
      (756::bigint, 3::bigint, 'Penalty / Late Fee'::text, 'Penalty / Late Fee - fdsf'::text, 200.00::numeric, 0.00::numeric)
    ) as expected(payment_id, property_id, charge_type, description, applied, unallocated)
  loop
    select * into payment_row
    from public.payments
    where id = rec.payment_id
    for update;

    if not found
      or payment_row.property_id <> rec.property_id
      or payment_row.charge_type <> rec.charge_type
      or payment_row.status = 'Voided'
      or abs(coalesce(payment_row.amount_paid, payment_row.amount) - rec.applied - rec.unallocated) > 0.005
      or abs(coalesce(payment_row.balance_effect, 0)) > 0.005
         and abs(coalesce(payment_row.balance_effect, 0) - rec.applied) > 0.005
    then
      raise exception 'Payment % no longer matches the confirmed receipt evidence; nothing was changed.', rec.payment_id;
    end if;

    select id into charge_id
    from public.property_charges
    where property_id = rec.property_id
      and charge_type = rec.charge_type
      and description = rec.description
      and amount = rec.applied
      and billing_month = payment_row.paid_at::date
      and voided_at is null
    limit 1;

    if charge_id is not null
       and abs(coalesce(payment_row.balance_effect, 0) - rec.applied) <= 0.005 then
      continue;
    end if;

    inserted_charge := false;
    if charge_id is null then
      insert into public.property_charges (
        property_id,
        charge_type,
        description,
        amount,
        billing_month,
        created_by_name,
        created_at
      )
      values (
        rec.property_id,
        rec.charge_type,
        rec.description,
        rec.applied,
        payment_row.paid_at::date,
        'Historical reconciliation',
        payment_row.paid_at
      )
      returning id into charge_id;
      inserted_charge := true;
    end if;

    applied := rec.applied;
    update public.payments
    set balance_effect = applied,
        previous_balance = payment_row.previous_balance,
        remaining_balance = payment_row.previous_balance - applied
    where id = rec.payment_id;

    if inserted_charge then
      -- Charge insertion increases the property balance; applying the
      -- confirmed payment offsets exactly the same amount.
      update public.properties
      set current_balance = current_balance - applied
      where id = rec.property_id;
    end if;
  end loop;

  select coalesce(sum(current_balance), 0) into after_total
  from public.properties;

  if abs(after_total - before_total) > 0.005 then
    raise exception 'Historical reconciliation changed aggregate property balances unexpectedly; nothing was changed.';
  end if;
end
$$;
