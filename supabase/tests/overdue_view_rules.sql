-- Replays the overdue/late-penalty rules against public.property_overdue_summary.
-- These rules used to be unit-tested in JavaScript (client/src/lib/latepenalty.js, now removed);
-- the database view is the single source of truth. Everything is rolled back at the end.
-- Run in the Supabase SQL editor. "Today" is the real Manila date, so expected days are relative:
--   with due_day 28 / grace 0 and today in October after the 20th, a September charge is (today - Sep 28) days late.
-- Uses property 22; change the id below if that account is ever removed.

begin;

create function pg_temp.scn(label text, bal numeric, due_day int, grace int, pen numeric, charges jsonb)
returns text language plpgsql as $f$
declare c jsonb; o record;
begin
  update public.system_settings set due_day = scn.due_day, grace_period_days = scn.grace, late_penalty = scn.pen where id = 1;
  delete from public.property_charges where property_id = 22;
  for c in select * from jsonb_array_elements(charges) loop
    insert into public.property_charges(property_id, charge_type, amount, billing_month, created_at)
    values (22, c->>'t', (c->>'a')::numeric, nullif(c->>'m','')::date, (c->>'ca')::timestamptz);
  end loop;
  update public.properties set current_balance = bal where id = 22;
  select is_overdue, days_overdue, overdue_amount, penalty_amount, balance into o
    from public.property_overdue_summary where property_id = 22;
  return format('%-36s overdue=%s days=%s overdueAmt=%s penalty=%s bal=%s', label, o.is_overdue, o.days_overdue, o.overdue_amount, o.penalty_amount, o.balance);
end $f$;

-- EXPECT overdue=f
select pg_temp.scn('credit never overdue',     -500, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"}]');
select pg_temp.scn('zero balance never overdue',  0, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"}]');
select pg_temp.scn('this month before deadline', 1000, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-10-01","ca":"2026-10-01T00:00:00Z"}]');
select pg_temp.scn('owes one month: newest unpaid', 1000, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"},{"t":"Association Dues","a":1000,"m":"2026-10-01","ca":"2026-10-01T00:00:00Z"}]');
-- EXPECT overdue=t, overdueAmt=1000, penalty=150, days = today - Sep 28
select pg_temp.scn('last month unpaid',          1000, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"}]');
select pg_temp.scn('owes both: oldest overdue',  2000, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"},{"t":"Association Dues","a":1000,"m":"2026-10-01","ca":"2026-10-01T00:00:00Z"}]');
-- EXPECT overdue=t (balance with no charge behind it is judged by the legacy rule)
select pg_temp.scn('legacy balance, no charge',  0.02, 28, 0, 150, '[]');
-- EXPECT overdue=t, penalty=0 (a real penalty charge exists, so no display-only penalty)
select pg_temp.scn('real penalty charge exists', 1150, 28, 0, 150, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"},{"t":"Penalty / Late Fee","a":150,"m":"","ca":"2026-10-02T00:00:00Z"}]');
-- EXPECT days = today - Sep 30 (due day 31 clamps to the last day of a 30-day month)
select pg_temp.scn('due day 31 clamps September', 1000, 31, 0, 0, '[{"t":"Association Dues","a":1000,"m":"2026-09-01","ca":"2026-09-01T00:00:00Z"}]');
select pg_temp.scn('legacy, due day 31, no charge', 1000, 31, 0, 0, '[]');

rollback;
