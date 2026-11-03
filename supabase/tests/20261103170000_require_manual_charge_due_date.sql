-- Stage 2 regression checks. Run manually in the Supabase SQL editor only
-- after reviewing and applying the migration; this file is not auto-executed.
begin;

do $$
declare
  property_id bigint;
  inserted_id uuid;
begin
  select id into property_id from public.properties order by id limit 1;
  if property_id is null then raise exception 'Test requires at least one property.'; end if;

  begin
    insert into public.property_charges(property_id, charge_type, amount, created_by_name)
      values (property_id, 'Other', 1, 'Stage 2 test');
    raise exception 'Manual charge without due_date was accepted.';
  exception when others then
    if sqlerrm not like '%final due date is required%' then raise; end if;
  end;

  insert into public.property_charges(property_id, charge_type, amount, due_date, created_by_name)
    values (property_id, 'Other', 1, public.hoa_manila_today(), 'Stage 2 test')
    returning id into inserted_id;
  if inserted_id is null then raise exception 'Manual charge with today due_date was not inserted.'; end if;
end;
$$;

do $$
declare
  monthly_definition text;
  penalty_definition text;
begin
  select pg_get_functiondef('public.bill_monthly_dues(date)'::regprocedure) into monthly_definition;
  select pg_get_functiondef('public.post_due_penalties(bigint)'::regprocedure) into penalty_definition;
  if position('app.charge_origin' in monthly_definition) = 0
     or position('monthly_dues' in monthly_definition) = 0 then
    raise exception 'Monthly billing is not marked as a trusted charge origin.';
  end if;
  if position('app.charge_origin' in penalty_definition) = 0
     or position('annual_penalty' in penalty_definition) = 0 then
    raise exception 'Annual penalty posting is not marked as a trusted charge origin.';
  end if;
end;
$$;

-- Calling the trusted monthly function must remain possible; all changes roll back.
select public.bill_monthly_dues(public.hoa_manila_today());

rollback;
