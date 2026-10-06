-- Keep explicit allocation records within the authoritative payment effect
-- and the referenced active charge. Allocation records do not change balances.
create or replace function public.validate_property_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_effect numeric(12,2);
  charge_amount numeric(12,2);
  allocated_for_payment numeric(12,2);
  allocated_for_charge numeric(12,2);
begin
  if new.allocated_amount <= 0 then
    raise exception 'Allocation amount must be positive.';
  end if;

  select greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0)
    into payment_effect
  from public.payments
  where id = new.payment_id
    and status is distinct from 'Voided'
  for update;

  if payment_effect is null then
    raise exception 'Payment % does not exist or is voided.', new.payment_id;
  end if;

  select amount
    into charge_amount
  from public.property_charges
  where id = new.property_charge_id
    and voided_at is null;

  if charge_amount is null then
    raise exception 'Property charge % does not exist or is voided.', new.property_charge_id;
  end if;

  select coalesce(sum(allocated_amount), 0)
    into allocated_for_payment
  from public.property_payment_allocations
  where payment_id = new.payment_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  select coalesce(sum(allocated_amount), 0)
    into allocated_for_charge
  from public.property_payment_allocations
  where property_charge_id = new.property_charge_id
    and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

  if allocated_for_payment + new.allocated_amount > payment_effect + 0.005 then
    raise exception 'Allocations for payment % exceed its applied effect (%).',
      new.payment_id, payment_effect;
  end if;

  if allocated_for_charge + new.allocated_amount > charge_amount + 0.005 then
    raise exception 'Allocations for charge % exceed its amount (%).',
      new.property_charge_id, charge_amount;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_property_payment_allocation_trigger
  on public.property_payment_allocations;
create trigger validate_property_payment_allocation_trigger
before insert or update on public.property_payment_allocations
for each row execute function public.validate_property_payment_allocation();

revoke all on function public.validate_property_payment_allocation() from public, anon;
