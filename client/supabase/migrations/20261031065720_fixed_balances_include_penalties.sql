-- Fixed/entered balances already include the HOA's recorded penalties.
-- Stop generated yearly additions; retain every receipt and historical penalty row.
-- Existing automatic charges are voided, never deleted. Manual penalty charges stay.
begin;
lock table public.properties, public.property_charges, public.balance_entries,
  public.late_payment_penalties, public.payments in share row exclusive mode;

create temporary table fixed_balance_original_properties on commit drop as
  select id, current_balance from public.properties;
create temporary table fixed_balance_extra_charges on commit drop as
  select c.id, c.property_id, c.amount
  from public.property_charges c
  where c.voided_at is null
    and c.charge_type = 'Penalty / Late Fee'
    and exists (
      select 1 from public.late_payment_penalties lp
      where lp.charge_id = c.id and lp.property_id = c.property_id
    );
create temporary table fixed_balance_immutable_before(table_name text primary key, fingerprint text)
  on commit drop;
do $$
declare tbl text; signature text;
begin
  foreach tbl in array array['payments','balance_entries','late_payment_penalties'] loop
    execute format('select count(*)::text || '':'' || md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by id), '''')) from public.%I t', tbl)
      into signature;
    insert into fixed_balance_immutable_before values(tbl, signature);
  end loop;
end $$;

-- Keep the signature and permissions compatible with the entry/payment triggers
-- and existing scheduled job. Each call now deliberately creates zero charges.
create or replace function public.post_due_penalties(p_property_id bigint default null)
returns integer language plpgsql security definer
set search_path to 'public', 'pg_temp' as $function$
begin
  if auth.uid() is not null
     and coalesce(public.current_user_role(), '') not in ('admin','secretary','treasurer') then
    raise exception 'You do not have permission to post penalties.';
  end if;
  return 0;
end;
$function$;
revoke all on function public.post_due_penalties(bigint) from public, anon;
grant execute on function public.post_due_penalties(bigint) to authenticated;

-- The existing apply_charge_to_balance trigger subtracts these charges using
-- Postgres NUMERIC arithmetic. Do not edit balances or payment snapshots by hand.
update public.property_charges c
set voided_at = now(),
    void_reason = 'fixed-balance-inclusive-20261031150000: entered balance already includes HOA penalties',
    voided_by = null
from fixed_balance_extra_charges target
where c.id = target.id and c.voided_at is null;

do $$
declare original record; signature text;
begin
  if exists (
    select 1 from fixed_balance_original_properties baseline
    left join (select property_id, sum(amount) as removed from fixed_balance_extra_charges group by property_id) removed
      on removed.property_id = baseline.id
    join public.properties p on p.id = baseline.id
    where p.current_balance is distinct from baseline.current_balance - coalesce(removed.removed, 0)
  ) then
    raise exception 'A balance correction did not match the voided automatic penalties; rolling back.';
  end if;
  if exists (
    select 1 from fixed_balance_extra_charges target join public.property_charges c on c.id=target.id
    where c.voided_at is null
  ) then
    raise exception 'An automatic penalty was not voided; rolling back.';
  end if;
  for original in select * from fixed_balance_immutable_before loop
    execute format('select count(*)::text || '':'' || md5(coalesce(string_agg(to_jsonb(t)::text, E''\n'' order by id), '''')) from public.%I t', original.table_name)
      into signature;
    if signature is distinct from original.fingerprint then
      raise exception 'Protected % rows changed; rolling back.', original.table_name;
    end if;
  end loop;
end $$;
commit;
