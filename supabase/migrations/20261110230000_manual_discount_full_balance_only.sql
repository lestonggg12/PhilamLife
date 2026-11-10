-- Business rule: manual discounts are only available when the original
-- outstanding debt is fully settled. Retained advance credit and partial
-- payments are ineligible. The separate annual (12 months, 1 free) promotion
-- is stored in receipt_breakdown and is not a manual_payment_discounts row.
-- Enforce at the journal boundary, regardless of which existing RPC is called.
create or replace function public.guard_manual_discount_full_settlement()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment
    from public.payments
    where id = new.payment_id;
  if not found or v_payment.property_id is distinct from new.property_id
     or v_payment.charge_type not in (
       'Association Dues', 'Balance Payment', 'Special Assessment',
       'Penalty / Late Fee', 'Sticker / ID Fee', 'Document / Certification Fee'
     ) or v_payment.previous_balance is null
     or v_payment.previous_balance <= 0
     or new.discount_amount is null
     or new.discount_amount <= 0
     or new.discount_amount >= v_payment.previous_balance
     or new.cash_received is distinct from v_payment.amount_paid
     or round(new.cash_received + new.discount_amount, 2)
        is distinct from round(v_payment.previous_balance, 2)
  then
    raise exception using errcode='22023',
      message='Manual discounts require full settlement of outstanding debt without advance credit or partial payment.';
  end if;
  return new;
end
$function$;

revoke all on function public.guard_manual_discount_full_settlement()
  from public, anon, authenticated;

drop trigger if exists guard_manual_discount_full_settlement
  on public.manual_payment_discounts;
create trigger guard_manual_discount_full_settlement
before insert or update of payment_id, property_id, charge_id, cash_received, discount_amount
on public.manual_payment_discounts
for each row execute function public.guard_manual_discount_full_settlement();
