alter table public.expenses
  add column status text not null default 'Completed'
  check (status = any (array['Completed', 'Voided']));
