-- Unused by the app; callable by any signed-in user and bypassed the receipt rules.
drop function if exists public.record_hoa_payment(bigint, numeric, text, text, text, text, text);

-- Missing foreign-key indexes (payments are queried by property constantly)
create index if not exists payments_property_id_idx on public.payments(property_id);
create index if not exists payments_recorded_by_idx on public.payments(recorded_by);
create index if not exists collection_actions_property_id_idx on public.collection_actions(property_id);
create index if not exists violations_property_id_idx on public.violations(property_id);
create index if not exists activity_log_user_id_idx on public.activity_log(user_id);

-- Duplicate index on expenses (identical to expenses_expense_date_idx)
drop index if exists public.expenses_date_idx;
