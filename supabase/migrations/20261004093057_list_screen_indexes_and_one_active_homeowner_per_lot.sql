-- Indexes that match how the app actually reads data: every list screen orders
-- by these columns (plus an id tiebreaker added by the fetchAll pagination helper).
create index if not exists activity_log_created_at_id_idx
  on public.activity_log (created_at desc, id);

create index if not exists payments_paid_at_id_idx
  on public.payments (paid_at desc, id);

create index if not exists expenses_expense_date_id_idx
  on public.expenses (expense_date desc, id);

-- Monthly billing runs and the "has this month's dues run?" check filter on billing_month.
-- (The existing unique index leads with property_id, so it cannot serve this lookup.)
create index if not exists property_charges_billing_month_idx
  on public.property_charges (billing_month);

-- Only ONE ACTIVE homeowner may hold a given block + lot. A lot can still be
-- reassigned after the previous homeowner is marked Moved/Transferred, which is
-- how the app is designed to work. Block names are compared case/space-insensitively,
-- matching the app's own duplicate check.
create unique index if not exists properties_one_active_homeowner_per_lot_idx
  on public.properties (lower(btrim(block)), lot_number)
  where coalesce(homeowner_status, 'active') = 'active';
