drop policy if exists "Authenticated users can read moved account reconciliations" on public.moved_account_reconciliations;
create policy "Staff can read moved account reconciliations" on public.moved_account_reconciliations
  for select to authenticated
  using ((select public.current_user_role()) = any (array['admin','secretary','treasurer']));

drop policy if exists "Authenticated users can read payment allocations" on public.payment_allocations;
create policy "Staff can read payment allocations" on public.payment_allocations
  for select to authenticated
  using ((select public.current_user_role()) = any (array['admin','secretary','treasurer']));

drop policy if exists "Authenticated users can read property payment allocations" on public.property_payment_allocations;
create policy "Staff can read property payment allocations" on public.property_payment_allocations
  for select to authenticated
  using ((select public.current_user_role()) = any (array['admin','secretary','treasurer']));;
