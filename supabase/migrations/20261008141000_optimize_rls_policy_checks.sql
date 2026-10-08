-- Cache stable auth and role lookups once per statement instead of once per row.
alter policy "Admin, Secretary, and Treasurer can create payments"
  on public.payments
  with check (
    (select public.current_user_role()) = any (array['admin', 'secretary', 'treasurer'])
    and recorded_by = (select auth.uid())
  );

alter policy "Staff can create own activity"
  on public.activity_log
  with check (
    (select public.current_user_role()) = any (array['admin', 'secretary', 'treasurer'])
    and user_id = (select auth.uid())
  );

alter policy "Secretary can create amenity services"
  on public.amenity_services
  with check (
    (select public.current_user_role()) = 'secretary'
    and created_by = (select auth.uid())
  );

alter policy "Secretary can record service transactions"
  on public.service_transactions
  with check (
    (select public.current_user_role()) = 'secretary'
    and recorded_by = (select auth.uid())
  );

alter policy "Treasurer can record expenses"
  on public.expenses
  with check (
    (select public.current_user_role()) = 'treasurer'
    and recorded_by = (select auth.uid())
    and status = any (array['Completed', 'Recorded'])
  );

alter policy "Staff can add manual charges"
  on public.property_charges
  with check (
    (select public.current_user_role()) = any (array['admin', 'secretary', 'treasurer'])
    and created_by = (select auth.uid())
    and billing_month is null
    and voided_at is null
  );

alter policy "Staff can record collection actions"
  on public.collection_actions
  with check (
    (select public.current_user_role()) = any (array['admin', 'secretary', 'treasurer'])
    and created_by = (select auth.uid())
  );

alter policy "Admin and Secretary can log violations"
  on public.violations
  with check (
    (select public.current_user_role()) = any (array['admin', 'secretary'])
    and created_by = (select auth.uid())
  );

-- These policies overlap with broader policies that already provide the same
-- effective access to the same authenticated staff roles.
drop policy if exists "Admin can view all activity" on public.activity_log;
drop policy if exists "Staff can view own activity" on public.activity_log;
drop policy if exists "HOA staff can read payment_allocations" on public.payment_allocations;

drop index if exists public.service_transactions_paid_at_idx2;
