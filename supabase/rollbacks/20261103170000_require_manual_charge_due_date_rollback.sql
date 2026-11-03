-- Emergency rollback of Stage 2 only. Preserves Stage 1 due-date immutability,
-- the due_date column, and all historical charge data.
begin;

drop trigger if exists require_manual_charge_due_date on public.property_charges;
drop function if exists public.require_manual_charge_due_date();

do $$
declare
  definition text;
  restored text;
begin
  select pg_get_functiondef('public.bill_monthly_dues(date)'::regprocedure) into definition;
  if position('previous_charge_origin' in definition) > 0 then
    restored := replace(definition,
      '  previous_charge_origin text := coalesce(current_setting(''app.charge_origin'', true), '''');' || chr(10), '');
    restored := replace(restored,
      '  perform set_config(''app.charge_origin'', ''monthly_dues'', true);' || chr(10), '');
    restored := replace(restored,
      '  perform set_config(''app.charge_origin'', previous_charge_origin, true);' || chr(10), '');
    if position('previous_charge_origin' in restored) > 0 then
      raise exception 'Could not restore bill_monthly_dues before rollback.';
    end if;
    execute restored;
  end if;

  select pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure) into definition;
  if position('previous_charge_origin' in definition) > 0 then
    restored := replace(definition,
      '  previous_charge_origin text := coalesce(current_setting(''app.charge_origin'', true), '''');' || chr(10), '');
    restored := replace(restored,
      '        perform set_config(''app.charge_origin'', ''annual_penalty'', true);' || chr(10), '');
    restored := replace(restored,
      '        perform set_config(''app.charge_origin'', previous_charge_origin, true);' || chr(10), '');
    if position('previous_charge_origin' in restored) > 0 then
      raise exception 'Could not restore post_due_penalties before rollback.';
    end if;
    execute restored;
  end if;
end;
$$;

commit;
