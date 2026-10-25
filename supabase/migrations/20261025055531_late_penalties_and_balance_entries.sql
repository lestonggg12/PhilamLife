-- ============================================================================
-- Balance entries + yearly late-payment penalties (admin-configurable)
-- Adds objects only. No existing rows are modified or deleted.
-- ============================================================================

-- 1. Admin settings -----------------------------------------------------------
alter table public.system_settings
  add column if not exists late_penalty_rate numeric(6,4) not null default 0.0150
    constraint system_settings_late_penalty_rate_range check (late_penalty_rate >= 0 and late_penalty_rate <= 1),
  add column if not exists late_penalty_first_after_months integer not null default 12
    constraint system_settings_late_penalty_months_range check (late_penalty_first_after_months between 1 and 600);

create table if not exists public.late_penalty_year_rates (
  year integer primary key check (year between 2000 and 2100),
  rate numeric(6,4) not null check (rate >= 0 and rate <= 1),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.late_penalty_year_rates enable row level security;
create policy "Staff can read penalty year rates" on public.late_penalty_year_rates
  for select to authenticated using ((select public.current_user_role()) = any (array['admin','secretary','treasurer']));
create policy "Admin can add penalty year rates" on public.late_penalty_year_rates
  for insert to authenticated with check ((select public.current_user_role()) = 'admin');
create policy "Admin can change penalty year rates" on public.late_penalty_year_rates
  for update to authenticated using ((select public.current_user_role()) = 'admin') with check ((select public.current_user_role()) = 'admin');
create policy "Admin can remove penalty year rates" on public.late_penalty_year_rates
  for delete to authenticated using ((select public.current_user_role()) = 'admin');

create or replace function public.stamp_penalty_year_rate()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger stamp_penalty_year_rate before insert or update on public.late_penalty_year_rates
  for each row execute function public.stamp_penalty_year_rate();

-- 2. Balance entries ----------------------------------------------------------
create table public.balance_entries (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  category text not null check (category in ('Association Dues','Special Assessment','Sticker / ID Fee','Document / Certification Fee')),
  amount numeric(12,2) not null check (amount > 0),
  as_of_date date not null,
  description text check (description is null or length(btrim(description)) <= 250),
  created_by uuid references auth.users(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  constraint balance_entries_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and coalesce(btrim(void_reason), '') <> ''))
);
create index balance_entries_property_idx on public.balance_entries (property_id);
alter table public.balance_entries enable row level security;
create policy "Staff can read balance entries" on public.balance_entries
  for select to authenticated using ((select public.current_user_role()) = any (array['admin','secretary','treasurer']));
create policy "Admin and Secretary can add balance entries" on public.balance_entries
  for insert to authenticated with check ((select public.current_user_role()) = any (array['admin','secretary']));
create policy "Admin and Secretary can void balance entries" on public.balance_entries
  for update to authenticated using ((select public.current_user_role()) = any (array['admin','secretary']))
  with check ((select public.current_user_role()) = any (array['admin','secretary']));

create or replace function public.prepare_balance_entry()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  new.description := nullif(btrim(new.description), '');
  new.as_of_date := coalesce(new.as_of_date, public.hoa_manila_today());
  if new.as_of_date > public.hoa_manila_today() then
    raise exception 'The "as of" date cannot be in the future.';
  end if;
  if new.as_of_date < date '1990-01-01' then
    raise exception 'The "as of" date is too far in the past.';
  end if;
  if not exists (select 1 from public.properties where id = new.property_id and homeowner_status = 'active') then
    raise exception 'Balances can only be added to active homeowners.';
  end if;
  if auth.uid() is not null then
    new.created_by := auth.uid();
    select coalesce(nullif(btrim(full_name), ''), email) into new.created_by_name from public.profiles where id = auth.uid();
  end if;
  new.created_by_name := coalesce(new.created_by_name, 'System');
  new.created_at := now();
  new.voided_at := null; new.voided_by := null; new.void_reason := null;
  return new;
end $$;
create trigger prepare_balance_entry before insert on public.balance_entries
  for each row execute function public.prepare_balance_entry();

create or replace function public.protect_balance_entry_fields()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$
begin
  if old.voided_at is not null then
    raise exception 'This balance entry is already voided.';
  end if;
  new.id := old.id; new.property_id := old.property_id; new.category := old.category;
  new.amount := old.amount; new.as_of_date := old.as_of_date; new.description := old.description;
  new.created_by := old.created_by; new.created_by_name := old.created_by_name; new.created_at := old.created_at;
  if new.voided_at is null then
    raise exception 'A balance entry cannot be edited. Void it with a reason and add a corrected one.';
  end if;
  if coalesce(btrim(new.void_reason), '') = '' then
    raise exception 'A reason is required to void a balance entry.';
  end if;
  new.voided_at := now();
  new.voided_by := auth.uid();
  return new;
end $$;
create trigger protect_balance_entry_fields before update on public.balance_entries
  for each row execute function public.protect_balance_entry_fields();

-- 3. Penalty records ----------------------------------------------------------
create table public.late_payment_penalties (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  balance_entry_id uuid not null references public.balance_entries(id) on delete restrict,
  anniversary_no integer not null check (anniversary_no >= 1),
  anniversary_date date not null,
  base_amount numeric(12,2) not null check (base_amount >= 0),
  rate numeric(6,4) not null check (rate >= 0 and rate <= 1),
  penalty_amount numeric(12,2) not null check (penalty_amount >= 0),
  charge_id uuid references public.property_charges(id) on delete restrict,
  posted_at timestamptz not null default now(),
  unique (balance_entry_id, anniversary_no),
  check ((penalty_amount = 0) = (charge_id is null))
);
create index late_payment_penalties_property_idx on public.late_payment_penalties (property_id);
create index late_payment_penalties_charge_idx on public.late_payment_penalties (charge_id);
alter table public.late_payment_penalties enable row level security;
create policy "Staff can read late payment penalties" on public.late_payment_penalties
  for select to authenticated using ((select public.current_user_role()) = any (array['admin','secretary','treasurer']));

-- 4. Per-item unpaid amounts (one row per entry, penalty and monthly dues charge).
--    Settlement order: entered balances (oldest first) -> penalties -> monthly dues.
--    Payments counted: purpose "Association Dues" or "Penalty / Late Fee" for those three;
--    entries of other categories are settled only by payments of that same category.
create or replace view public.property_balance_items with (security_invoker = true) as
with pools as (
  select p.id as property_id,
    coalesce(sum(greatest(coalesce(pay.balance_effect,0) - coalesce(pay.effect_released,0), 0))
      filter (where coalesce(pay.charge_type,'Association Dues') in ('Association Dues','Penalty / Late Fee')), 0) as dues_pool,
    coalesce(sum(greatest(coalesce(pay.balance_effect,0) - coalesce(pay.effect_released,0), 0))
      filter (where pay.charge_type = 'Special Assessment'), 0) as sa_pool,
    coalesce(sum(greatest(coalesce(pay.balance_effect,0) - coalesce(pay.effect_released,0), 0))
      filter (where pay.charge_type = 'Sticker / ID Fee'), 0) as sticker_pool,
    coalesce(sum(greatest(coalesce(pay.balance_effect,0) - coalesce(pay.effect_released,0), 0))
      filter (where pay.charge_type = 'Document / Certification Fee'), 0) as doc_pool
  from public.properties p
  left join public.payments pay on pay.property_id = p.id and pay.status is distinct from 'Voided'
  group by p.id
),
entries as (
  select e.*,
    case e.category when 'Association Dues' then po.dues_pool when 'Special Assessment' then po.sa_pool
                    when 'Sticker / ID Fee' then po.sticker_pool else po.doc_pool end as pool,
    sum(e.amount) over (partition by e.property_id, e.category order by e.as_of_date, e.created_at, e.id) as cum
  from public.balance_entries e join pools po on po.property_id = e.property_id
  where e.voided_at is null
),
dues_entries_total as (
  select property_id, sum(amount) as t from public.balance_entries
  where voided_at is null and category = 'Association Dues' group by property_id
),
pen as (
  select c.id, c.property_id, c.amount, c.description, lp.anniversary_no, lp.anniversary_date, lp.rate, lp.base_amount,
    sum(c.amount) over (partition by c.property_id
      order by coalesce(lp.anniversary_date, (c.created_at at time zone 'Asia/Manila')::date), c.created_at, c.id) as cum
  from public.property_charges c
  left join public.late_payment_penalties lp on lp.charge_id = c.id
  where c.charge_type = 'Penalty / Late Fee' and c.voided_at is null
),
pen_total as (select property_id, sum(amount) as t from pen group by property_id),
dues as (
  select c.id, c.property_id, c.billing_month, c.amount,
    sum(c.amount) over (partition by c.property_id order by c.billing_month, c.created_at, c.id) as cum
  from public.property_charges c
  where c.charge_type = 'Association Dues' and c.voided_at is null
)
select en.property_id, 'entry'::text as kind, en.id as ref_id, en.category, en.as_of_date as item_date,
       coalesce(en.description, en.category || ' balance') as label, en.amount::numeric(12,2) as original,
       greatest(0, least(en.amount, en.cum - en.pool))::numeric(12,2) as unpaid,
       null::integer as penalty_no, null::numeric as rate, null::numeric as base_amount
from entries en
union all
select pn.property_id, 'penalty', pn.id, 'Penalty / Late Fee',
       coalesce(pn.anniversary_date, current_date), coalesce(pn.description, 'Penalty / Late Fee'), pn.amount::numeric(12,2),
       greatest(0, least(pn.amount, pn.cum - greatest(0, po.dues_pool - coalesce(det.t, 0))))::numeric(12,2),
       pn.anniversary_no, pn.rate, pn.base_amount
from pen pn
join pools po on po.property_id = pn.property_id
left join dues_entries_total det on det.property_id = pn.property_id
union all
select d.property_id, 'dues', d.id, 'Association Dues', d.billing_month,
       to_char(d.billing_month, 'FMMonth YYYY') || ' monthly dues', d.amount::numeric(12,2),
       greatest(0, least(d.amount, d.cum - greatest(0, po.dues_pool - coalesce(det.t, 0) - coalesce(pt.t, 0))))::numeric(12,2),
       null::integer, null::numeric, null::numeric
from dues d
join pools po on po.property_id = d.property_id
left join dues_entries_total det on det.property_id = d.property_id
left join pen_total pt on pt.property_id = d.property_id;

-- 5. One row per homeowner -----------------------------------------------------
create or replace view public.homeowner_balance_breakdown with (security_invoker = true) as
select p.id as property_id, p.homeowner_name, p.block, p.lot_number, p.homeowner_status,
  coalesce(sum(i.unpaid) filter (where i.kind = 'entry'), 0)::numeric(12,2) as entered_balance_unpaid,
  (count(*) filter (where i.kind = 'dues' and i.unpaid > 0))::integer as unpaid_dues_months,
  coalesce(sum(i.unpaid) filter (where i.kind = 'dues'), 0)::numeric(12,2) as unpaid_dues_total,
  (count(*) filter (where i.kind = 'penalty'))::integer as penalties_posted_count,
  (count(*) filter (where i.kind = 'penalty' and i.rate is not null))::integer as penalties_rated_count,
  coalesce(sum(i.original) filter (where i.kind = 'penalty'), 0)::numeric(12,2) as penalties_posted_total,
  coalesce(sum(i.unpaid) filter (where i.kind = 'penalty'), 0)::numeric(12,2) as penalties_outstanding,
  lp.original as latest_penalty_amount,
  lp.item_date as latest_penalty_date,
  min(i.rate) filter (where i.kind = 'penalty') as penalty_rate_min,
  max(i.rate) filter (where i.kind = 'penalty') as penalty_rate_max,
  (coalesce(sum(i.unpaid) filter (where i.kind = 'entry'), 0)
   + coalesce(sum(i.unpaid) filter (where i.kind = 'penalty'), 0)
   + coalesce(sum(i.unpaid) filter (where i.kind = 'dues'), 0))::numeric(12,2) as grand_total_due,
  p.current_balance
from public.properties p
left join public.property_balance_items i on i.property_id = p.id
left join lateral (
  select x.original, x.item_date from public.property_balance_items x
  where x.property_id = p.id and x.kind = 'penalty'
  order by x.item_date desc, x.penalty_no desc nulls last limit 1
) lp on true
group by p.id, p.homeowner_name, p.block, p.lot_number, p.homeowner_status, p.current_balance, lp.original, lp.item_date;

-- 6. Receipt snapshot ----------------------------------------------------------
alter table public.payments add column if not exists receipt_breakdown jsonb;

create or replace function public.receipt_breakdown_for(p_property_id bigint)
returns jsonb language sql security definer set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object(
    'entered_balance', b.entered_balance_unpaid,
    'penalties_count', b.penalties_posted_count,
    'penalties_rated_count', b.penalties_rated_count,
    'penalties_posted_total', b.penalties_posted_total,
    'penalties_outstanding', b.penalties_outstanding,
    'rate_min', b.penalty_rate_min,
    'rate_max', b.penalty_rate_max,
    'unpaid_dues', b.unpaid_dues_total,
    'unpaid_dues_months', b.unpaid_dues_months,
    'total_due', b.grand_total_due,
    'entry_lines', (select coalesce(jsonb_agg(jsonb_build_object('category', x.category, 'as_of', x.item_date, 'description', x.label, 'original', x.original, 'unpaid', x.unpaid) order by x.item_date), '[]'::jsonb)
                    from public.property_balance_items x where x.property_id = p_property_id and x.kind = 'entry' and x.unpaid > 0),
    'penalty_lines', (select coalesce(jsonb_agg(jsonb_build_object('no', x.penalty_no, 'date', x.item_date, 'rate', x.rate, 'base', x.base_amount, 'amount', x.original, 'unpaid', x.unpaid) order by x.item_date, x.penalty_no), '[]'::jsonb)
                      from public.property_balance_items x where x.property_id = p_property_id and x.kind = 'penalty')
  )
  from public.homeowner_balance_breakdown b where b.property_id = p_property_id;
$$;
revoke all on function public.receipt_breakdown_for(bigint) from public, anon, authenticated;

-- 7. The posting function (idempotent) -----------------------------------------
create or replace function public.post_due_penalties(p_property_id bigint default null)
returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  today date := public.hoa_manila_today();
  default_rate numeric;
  first_after integer;
  k_min integer;
  r record;
  yr_rate numeric;
  pen numeric(12,2);
  cid uuid;
  ann date;
  n integer := 0;
begin
  if auth.uid() is not null and coalesce(public.current_user_role(), '') not in ('admin','secretary','treasurer') then
    raise exception 'You do not have permission to post penalties.';
  end if;

  select late_penalty_rate, late_penalty_first_after_months into default_rate, first_after
  from public.system_settings where id = 1;
  if default_rate is null then return 0; end if;
  k_min := greatest(1, ceil(first_after / 12.0)::integer);

  for r in
    select e.id as entry_id, e.property_id, e.as_of_date, e.category, i.unpaid as base_now, k.k as k_no
    from public.balance_entries e
    join public.properties p on p.id = e.property_id and p.homeowner_status = 'active'
    join public.property_balance_items i on i.kind = 'entry' and i.ref_id = e.id
    cross join lateral generate_series(k_min, greatest(extract(year from age(today, e.as_of_date))::integer, 0)) as k(k)
    where e.voided_at is null
      and (p_property_id is null or e.property_id = p_property_id)
      and not exists (select 1 from public.late_payment_penalties lp where lp.balance_entry_id = e.id and lp.anniversary_no = k.k)
    order by e.property_id, e.as_of_date, e.id, k.k
  loop
    perform pg_advisory_xact_lock(hashtext('late-penalty:' || r.property_id::text));
    if exists (select 1 from public.late_payment_penalties lp where lp.balance_entry_id = r.entry_id and lp.anniversary_no = r.k_no) then
      continue;
    end if;

    ann := (r.as_of_date + make_interval(years => r.k_no))::date;
    select y.rate into yr_rate from public.late_penalty_year_rates y where y.year = extract(year from ann)::integer;
    yr_rate := coalesce(yr_rate, default_rate);
    pen := round(r.base_now * yr_rate, 2);
    cid := null;

    if pen > 0 then
      insert into public.property_charges (property_id, charge_type, description, amount, billing_month, created_by, created_by_name)
      values (r.property_id, 'Penalty / Late Fee',
              left(format('Year %s late penalty: %s%% of ₱%s unpaid (%s balance as of %s)',
                   r.k_no,
                   rtrim(rtrim(to_char(yr_rate * 100, 'FM990.00'), '0'), '.'),
                   to_char(r.base_now, 'FM999,999,999,990.00'),
                   r.category,
                   to_char(r.as_of_date, 'FMDD Mon YYYY')), 250),
              pen, null, null, 'System (automatic)')
      returning id into cid;
    end if;

    insert into public.late_payment_penalties (property_id, balance_entry_id, anniversary_no, anniversary_date, base_amount, rate, penalty_amount, charge_id)
    values (r.property_id, r.entry_id, r.k_no, ann, r.base_now, yr_rate, pen, cid);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.post_due_penalties(bigint) from public, anon;
grant execute on function public.post_due_penalties(bigint) to authenticated;

-- 8. Entry side effects ---------------------------------------------------------
create or replace function public.apply_balance_entry()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  update public.properties p set
    current_balance = coalesce(p.current_balance, 0) + new.amount,
    opening_balance = coalesce(p.opening_balance, 0) + new.amount,
    opening_balance_as_of = least(coalesce(p.opening_balance_as_of, new.as_of_date), new.as_of_date),
    opening_balance_note = (select string_agg(coalesce(e.description, e.category || ' balance'), '; ' order by e.as_of_date, e.created_at)
                            from public.balance_entries e where e.property_id = new.property_id and e.voided_at is null)
  where p.id = new.property_id;
  perform public.post_due_penalties(new.property_id);
  return new;
end $$;
create trigger apply_balance_entry after insert on public.balance_entries
  for each row execute function public.apply_balance_entry();
revoke execute on function public.apply_balance_entry() from public, anon, authenticated;

create or replace function public.void_balance_entry_effects()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if old.voided_at is null and new.voided_at is not null then
    update public.property_charges c
       set voided_at = now(), void_reason = 'Balance entry voided: ' || new.void_reason
     where c.voided_at is null
       and c.id in (select lp.charge_id from public.late_payment_penalties lp where lp.balance_entry_id = new.id and lp.charge_id is not null);
    update public.properties p set
      current_balance = coalesce(p.current_balance, 0) - new.amount,
      opening_balance = coalesce(p.opening_balance, 0) - new.amount,
      opening_balance_as_of = (select min(e.as_of_date) from public.balance_entries e where e.property_id = new.property_id and e.voided_at is null),
      opening_balance_note = (select string_agg(coalesce(e.description, e.category || ' balance'), '; ' order by e.as_of_date, e.created_at)
                              from public.balance_entries e where e.property_id = new.property_id and e.voided_at is null)
    where p.id = new.property_id;
  end if;
  return new;
end $$;
create trigger void_balance_entry_effects after update of voided_at on public.balance_entries
  for each row execute function public.void_balance_entry_effects();
revoke execute on function public.void_balance_entry_effects() from public, anon, authenticated;

-- 9. Payments: post due penalties first, then save the receipt breakdown --------
create or replace function public.prepare_payment_record()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  bal numeric(12,2);
  paid numeric(12,2);
  ct text;
  charged numeric(12,2);
  applied numeric(12,2);
  effect numeric(12,2);
begin
  if new.paid_at is null then new.paid_at := now(); end if;
  if new.created_at is null then new.created_at := now(); end if;

  if auth.uid() is not null then
    new.status := 'Completed';
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.effect_released := 0;
  end if;

  if new.receipt_number is null or trim(new.receipt_number) = '' then
    new.receipt_number := 'OR-' || to_char(timezone('Asia/Manila', new.paid_at), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_sequence')::text, 6, '0');
  end if;

  paid := coalesce(new.amount_paid, new.amount);
  if paid is null or paid <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  new.amount_paid := paid;
  ct := coalesce(new.charge_type, 'Association Dues');
  if ct not in ('Association Dues','Special Assessment','Penalty / Late Fee','Sticker / ID Fee','Document / Certification Fee','Other') then
    ct := 'Other';
  end if;
  new.charge_type := ct;

  if new.property_id is not null then
    -- Any yearly penalty that has fallen due is posted before the balance is read.
    perform public.post_due_penalties(new.property_id);

    select current_balance into bal
    from public.properties
    where id = new.property_id
    for update;
    if not found then raise exception 'Property not found.'; end if;

    if ct = 'Other' then
      select coalesce(sum(amount), 0) into charged
      from public.property_charges
      where property_id = new.property_id
        and charge_type = ct
        and voided_at is null;

      select coalesce(sum(balance_effect - effect_released), 0) into applied
      from public.payments
      where property_id = new.property_id
        and charge_type = ct
        and status <> 'Voided';

      effect := least(paid, greatest(charged - applied, 0));
    else
      -- Association Dues and typed fees: the full amount reaches the balance; any excess is advance credit.
      effect := paid;
    end if;

    -- Snapshot of what was owed just before this payment, printed on the receipt.
    new.receipt_breakdown := public.receipt_breakdown_for(new.property_id);

    new.previous_balance := bal;
    new.balance_effect := effect;
    new.remaining_balance := bal - effect;
    update public.properties
    set current_balance = new.remaining_balance
    where id = new.property_id;
  else
    new.balance_effect := 0;
    new.remaining_balance := coalesce(new.previous_balance, 0) - paid;
  end if;

  return new;
end;
$function$;

create or replace function public.protect_payment_financial_fields()
returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if auth.uid() is null then return new; end if;
  new.id := old.id;
  new.property_id := old.property_id;
  new.amount := old.amount;
  new.amount_paid := old.amount_paid;
  new.previous_balance := old.previous_balance;
  new.remaining_balance := old.remaining_balance;
  new.receipt_number := old.receipt_number;
  new.paid_at := old.paid_at;
  new.payment_date := old.payment_date;
  new.created_at := old.created_at;
  new.recorded_by := old.recorded_by;
  new.recorded_by_name := old.recorded_by_name;
  new.homeowner_name := old.homeowner_name;
  new.block_name := old.block_name;
  new.lot_number := old.lot_number;
  new.coverage_period := old.coverage_period;
  new.payment_method := old.payment_method;
  new.reference_number := old.reference_number;
  new.charge_type := old.charge_type;
  new.balance_effect := old.balance_effect;
  new.receipt_breakdown := old.receipt_breakdown;
  if pg_trigger_depth() = 1 then new.effect_released := old.effect_released; end if;

  if old.status = 'Voided' then
    new.status := 'Voided';
    new.voided_at := old.voided_at;
    new.voided_by := old.voided_by;
    new.void_reason := old.void_reason;
  elsif new.status = 'Voided' then
    if coalesce(btrim(new.void_reason), '') = '' then
      raise exception 'A reason is required to void a payment.';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
  else
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
  end if;
  return new;
end $function$;

-- 10. Privileges ------------------------------------------------------------------
revoke all on public.balance_entries, public.late_payment_penalties, public.late_penalty_year_rates from anon;
revoke all on public.property_balance_items, public.homeowner_balance_breakdown from public, anon;
grant select on public.property_balance_items, public.homeowner_balance_breakdown to authenticated;
revoke truncate, references, trigger on public.balance_entries, public.late_payment_penalties, public.late_penalty_year_rates from authenticated;
revoke insert, update, delete on public.late_payment_penalties from authenticated;
revoke delete on public.balance_entries from authenticated;

-- 11. Daily run at 00:10 Manila (16:10 UTC) --------------------------------------
select cron.schedule('post-late-penalties', '10 16 * * *', $$select public.post_due_penalties()$$);