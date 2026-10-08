drop policy if exists "Secretary can view documents" on public.documents;

create policy "Admin and Secretary can view documents"
on public.documents
for select
to authenticated
using (current_user_role() = any (array['admin', 'secretary']));
