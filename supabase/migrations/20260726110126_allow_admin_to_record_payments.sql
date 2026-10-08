drop policy if exists "Secretary and Treasurer can create payments" on public.payments;

create policy "Admin, Secretary, and Treasurer can create payments"
on public.payments
for insert
to authenticated
with check (
  (current_user_role() = any (array['admin', 'secretary', 'treasurer']))
  and (recorded_by = auth.uid())
);
