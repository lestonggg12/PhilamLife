-- Compute display-only overdue status in PostgreSQL so list screens do not
-- download every historical charge for every property.
create or replace view public.property_overdue_summary
with (security_invoker = true) as
with settings as (
  select
    least(greatest(coalesce(due_day, 5), 1), 31)::int as due_day,
    greatest(coalesce(grace_period_days, 0), 0)::int as grace_period_days,
    coalesce(late_penalty, 0)::numeric as late_penalty
  from public.system_settings
  where id = 1
),
clock as (
  select
    (now() at time zone 'Asia/Manila')::date as today,
    date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date as month_start
),
deadlines as (
  select
    s.*,
    c.today,
    case
      when (
        c.month_start
        + (
          least(s.due_day, extract(day from (c.month_start + interval '1 month - 1 day'))::int) - 1
          + s.grace_period_days
        ) * interval '1 day'
      ) > c.today
      then (
        c.month_start - interval '1 month'
        + (
          least(s.due_day, extract(day from (c.month_start - interval '1 day'))::int) - 1
          + s.grace_period_days
        ) * interval '1 day'
      )::date
      else (
        c.month_start
        + (
          least(s.due_day, extract(day from (c.month_start + interval '1 month - 1 day'))::int) - 1
          + s.grace_period_days
        ) * interval '1 day'
      )::date
    end as legacy_deadline
  from settings s
  cross join clock c
),
property_balances as (
  select
    p.id as property_id,
    greatest(coalesce(p.current_balance, 0), 0)::numeric as balance
  from public.properties p
),
charge_rows as (
  select
    c.id,
    c.property_id,
    coalesce(c.amount, 0)::numeric as amount,
    c.charge_type,
    c.created_at,
    case
      when c.billing_month is not null then (
        date_trunc('month', c.billing_month::date)::date
        + (
          least(d.due_day, extract(day from (date_trunc('month', c.billing_month::date) + interval '1 month - 1 day'))::int) - 1
          + d.grace_period_days
        ) * interval '1 day'
      )::date
      else (
        (c.created_at at time zone 'Asia/Manila')::date + d.grace_period_days
      )
    end as deadline
  from public.property_charges c
  cross join deadlines d
  where c.voided_at is null
),
ranked_charges as (
  select
    r.*,
    coalesce(
      sum(r.amount) over (
        partition by r.property_id
        order by r.deadline desc, r.created_at desc, r.id desc
        rows between unbounded preceding and 1 preceding
      ),
      0
    ) as newer_amount
  from charge_rows r
),
allocated_charges as (
  select
    r.*,
    greatest(
      least(b.balance - r.newer_amount, r.amount),
      0
    )::numeric as allocated_amount
  from ranked_charges r
  join property_balances b using (property_id)
),
charge_totals as (
  select
    property_id,
    coalesce(sum(amount), 0)::numeric as charged_amount,
    coalesce(sum(allocated_amount) filter (where deadline < d.today), 0)::numeric as overdue_charge_amount,
    min(deadline) filter (
      where deadline < d.today and allocated_amount > 0.005
    ) as oldest_overdue_deadline
  from allocated_charges
  cross join deadlines d
  group by property_id
),
property_status as (
  select
    b.property_id,
    b.balance,
    coalesce(t.charged_amount, 0)::numeric as charged_amount,
    coalesce(t.overdue_charge_amount, 0)::numeric as overdue_charge_amount,
    t.oldest_overdue_deadline,
    d.legacy_deadline,
    greatest(b.balance - coalesce(t.charged_amount, 0), 0)::numeric as legacy_amount,
    d.today,
    d.late_penalty
  from property_balances b
  cross join deadlines d
  left join charge_totals t using (property_id)
),
with_legacy as (
  select
    s.*,
    (
      s.legacy_amount > 0.005
      and s.today > s.legacy_deadline
    ) as legacy_is_overdue
  from property_status s
),
final_status as (
  select
    w.*,
    round(
      w.overdue_charge_amount
      + case when w.legacy_is_overdue then w.legacy_amount else 0 end,
      2
    )::numeric as overdue_amount,
    case
      when w.oldest_overdue_deadline is not null
        and w.legacy_is_overdue
      then least(w.oldest_overdue_deadline, w.legacy_deadline)
      else coalesce(w.oldest_overdue_deadline,
        case when w.legacy_is_overdue then w.legacy_deadline end)
    end as oldest_overdue_date
  from with_legacy w
)
select
  f.property_id,
  f.balance,
  f.overdue_amount,
  (f.overdue_amount > 0.005) as is_overdue,
  case
    when f.overdue_amount > 0.005
    then greatest(
      0,
      (f.today - f.oldest_overdue_date)
    )::int
    else 0
  end as days_overdue,
  case
    when f.overdue_amount > 0.005
      and not exists (
        select 1
        from public.property_charges c
        where c.property_id = f.property_id
          and c.voided_at is null
          and c.charge_type = 'Penalty / Late Fee'
          and c.created_at >= f.oldest_overdue_date
      )
    then f.late_penalty
    else 0
  end::numeric as penalty_amount,
  (
    f.balance
    + case
        when f.overdue_amount > 0.005
          and not exists (
            select 1
            from public.property_charges c
            where c.property_id = f.property_id
              and c.voided_at is null
              and c.charge_type = 'Penalty / Late Fee'
              and c.created_at >= f.oldest_overdue_date
          )
        then f.late_penalty
        else 0
      end
  )::numeric as total_due
from final_status f;

revoke all on public.property_overdue_summary from anon;
grant select on public.property_overdue_summary to authenticated;
