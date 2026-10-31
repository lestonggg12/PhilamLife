-- REVIEW AND APPROVE before running on live. Deploy the previous UI with rollback.
-- Only the new identity layer is removed. All lots, names, contacts and financial
-- rows (including lots added since migration) remain in properties unchanged.
-- The pre-existing active-lot unique index is intentionally retained.
begin;
lock table public.properties in share row exclusive mode;
drop trigger multilot_property_contact_changed on public.properties;
drop trigger multilot_assign_homeowner on public.properties;
drop trigger multilot_homeowner_contact_changed on public.homeowners;
drop function public.multilot_property_contact_changed();
drop function public.multilot_assign_homeowner();
drop function public.multilot_homeowner_contact_changed();
alter table public.properties drop constraint properties_lot_number_positive;
alter table public.properties drop column homeowner_id;
drop table public.homeowners;
commit;
