drop policy if exists "Treasurer can void expenses" on public.expenses;

create policy "Admin and Secretary can void expenses"
on public.expenses
for update
to authenticated
using (
  (select public.current_user_role()) = any (array['admin','secretary'])
  and status = any (array['Completed','Recorded'])
)
with check (
  (select public.current_user_role()) = any (array['admin','secretary'])
  and status = 'Voided'
);