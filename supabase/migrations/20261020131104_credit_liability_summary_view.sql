-- Advance credit the association is holding (negative balances), split into active and moved/transferred accounts.
create or replace view public.credit_liability_summary
with (security_invoker = true) as
select
  (count(*) filter (where current_balance < 0 and coalesce(homeowner_status, 'active') = 'active'))::int as active_credit_accounts,
  coalesce(sum(-current_balance) filter (where current_balance < 0 and coalesce(homeowner_status, 'active') = 'active'), 0)::numeric(12,2) as active_credit_total,
  (count(*) filter (where current_balance < 0 and coalesce(homeowner_status, 'active') <> 'active'))::int as moved_credit_accounts,
  coalesce(sum(-current_balance) filter (where current_balance < 0 and coalesce(homeowner_status, 'active') <> 'active'), 0)::numeric(12,2) as moved_credit_total
from public.properties;

revoke all on public.credit_liability_summary from anon;
grant select on public.credit_liability_summary to authenticated;