begin;

drop table if exists public.board_action_items cascade;
drop table if exists public.capital_projects cascade;
drop table if exists public.maintenance_requests cascade;
drop table if exists public.security_incidents cascade;
drop table if exists public.funds cascade;
drop table if exists public.fund_transactions cascade;
drop table if exists public.bank_deposit_receipts cascade;
drop table if exists public.email_deliveries cascade;
drop table if exists public.email_campaigns cascade;
drop table if exists public.property_ownerships cascade;
drop table if exists public.assessment_schedules cascade;
drop table if exists public.homeowner_charges cascade;

commit;
