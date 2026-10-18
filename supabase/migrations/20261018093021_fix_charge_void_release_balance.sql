-- Root cause: when a fee charge is voided, payments that had paid it are "released"
-- (effect_released += take) but properties.current_balance was never increased by the
-- released amount, so stored balance drifted below financial_invariant_report.expected_balance.
create or replace function public.apply_charge_to_balance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  charged numeric(12,2);
  applied numeric(12,2);
  excess numeric(12,2);
  take numeric(12,2);
  rec record;
begin
  if tg_op = 'INSERT' then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;

  elsif old.voided_at is null and new.voided_at is not null then
    update public.properties set current_balance = current_balance - new.amount where id = new.property_id;

    -- Fee payments that had paid this charge no longer match any active charge:
    -- release them so they cannot swallow the next charge of the same type.
    if new.charge_type <> 'Association Dues' then
      select coalesce(sum(amount), 0) into charged
        from public.property_charges
        where property_id = new.property_id and charge_type = new.charge_type and voided_at is null;
      select coalesce(sum(balance_effect - effect_released), 0) into applied
        from public.payments
        where property_id = new.property_id and charge_type = new.charge_type and status <> 'Voided';
      excess := greatest(applied - charged, 0);

      for rec in
        select id, (balance_effect - effect_released) as avail
        from public.payments
        where property_id = new.property_id and charge_type = new.charge_type
          and status <> 'Voided' and (balance_effect - effect_released) > 0
        order by paid_at desc, id desc
      loop
        exit when excess <= 0;
        take := least(excess, rec.avail);
        update public.payments set effect_released = effect_released + take where id = rec.id;
        -- The released portion no longer reduces the balance.
        update public.properties set current_balance = current_balance + take where id = new.property_id;
        excess := excess - take;
      end loop;
    end if;

  elsif old.voided_at is not null and new.voided_at is null then
    update public.properties set current_balance = current_balance + new.amount where id = new.property_id;
  end if;
  return new;
end $function$;

-- One-time repair of the two accounts that drifted before this fix
-- (property 22: -500 -> 0, released 500; property 2: 0 -> 600, released 600).
update public.properties p
set current_balance = r.expected_balance
from public.financial_invariant_report r
where r.property_id = p.id
  and r.invariant_status = 'active_mismatch'
  and p.id in (2, 22);