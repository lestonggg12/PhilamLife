-- Correction of 20261018090332: Admin and Secretary are view-only overseers for expenses;
-- the Treasurer has full authority (record and void). Restores the original Treasurer void policy.
drop policy if exists "Admin and Secretary can void expenses" on public.expenses;
drop policy if exists "Treasurer can void expenses" on public.expenses;

create policy "Treasurer can void expenses"
on public.expenses
for update
to authenticated
using (
  (select public.current_user_role()) = 'treasurer'
  and status = any (array['Completed','Recorded'])
)
with check (
  (select public.current_user_role()) = 'treasurer'
  and status = 'Voided'
);