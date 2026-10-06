-- Document historical effects cleared when properties were moved.
-- These are reconciliation metadata, not charges or payments.
create table if not exists public.moved_account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  property_id bigint not null references public.properties(id) on delete restrict,
  adjustment_amount numeric(12,2) not null,
  reason text not null,
  recorded_at timestamptz not null default now(),
  unique (property_id),
  check (adjustment_amount <> 0)
);

alter table public.moved_account_reconciliations enable row level security;

drop policy if exists "Authenticated users can read moved account reconciliations"
  on public.moved_account_reconciliations;
create policy "Authenticated users can read moved account reconciliations"
  on public.moved_account_reconciliations
  for select to authenticated
  using (true);

insert into public.moved_account_reconciliations (
  property_id,
  adjustment_amount,
  reason
)
values
  (5, 2900.00,
   'Closed moved account: historical payment effects totaling PHP 2,900.00 were cleared when the property balance was reset to zero.'),
  (6, 600.00,
   'Closed moved account: historical payment effect of PHP 600.00 was cleared when the property balance was reset to zero.')
on conflict (property_id) do update
set adjustment_amount = excluded.adjustment_amount,
    reason = excluded.reason;

create or replace view public.financial_invariant_report
with (security_invoker = true)
as
select
  p.id as property_id,
  p.homeowner_name,
  p.homeowner_status,
  coalesce(p.opening_balance, 0)::numeric(12,2) as opening_balance,
  coalesce(c.charged_amount, 0)::numeric(12,2) as active_charges,
  coalesce(pay.applied_amount, 0)::numeric(12,2) as applied_effects,
  coalesce(p.current_balance, 0)::numeric(12,2) as stored_balance,
  (
    coalesce(p.opening_balance, 0)
    + coalesce(c.charged_amount, 0)
    - coalesce(pay.applied_amount, 0)
    + coalesce(adj.adjustment_amount, 0)
  )::numeric(12,2) as expected_balance,
  (
    coalesce(p.opening_balance, 0)
    + coalesce(c.charged_amount, 0)
    - coalesce(pay.applied_amount, 0)
    + coalesce(adj.adjustment_amount, 0)
    - coalesce(p.current_balance, 0)
  )::numeric(12,2) as reconciliation_difference,
  case
    when abs(
      coalesce(p.opening_balance, 0)
      + coalesce(c.charged_amount, 0)
      - coalesce(pay.applied_amount, 0)
      + coalesce(adj.adjustment_amount, 0)
      - coalesce(p.current_balance, 0)
    ) <= 0.005 then 'reconciled'
    when p.homeowner_status <> 'active' then 'inactive_mismatch'
    else 'active_mismatch'
  end as invariant_status,
  coalesce(adj.adjustment_amount, 0)::numeric(12,2) as closing_adjustment
from public.properties p
left join (
  select property_id, sum(amount) as charged_amount
  from public.property_charges
  where voided_at is null
  group by property_id
) c on c.property_id = p.id
left join (
  select property_id,
         sum(greatest(coalesce(balance_effect, 0) - coalesce(effect_released, 0), 0))
           as applied_amount
  from public.payments
  where status is distinct from 'Voided'
  group by property_id
) pay on pay.property_id = p.id
left join public.moved_account_reconciliations adj on adj.property_id = p.id;

comment on table public.moved_account_reconciliations is
  'Audit metadata for historical payment effects cleared when moved properties were closed; never treated as a charge or payment.';
