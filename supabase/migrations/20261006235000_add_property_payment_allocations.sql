-- Evidence-backed allocations for the current property_charges ledger.
-- This is separate from the archived payment_allocations table, whose charge
-- model and required actor fields are different.
create table if not exists public.property_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id bigint not null references public.payments(id) on delete restrict,
  property_charge_id uuid not null references public.property_charges(id) on delete restrict,
  allocated_amount numeric(12,2) not null check (allocated_amount > 0),
  allocation_note text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (payment_id, property_charge_id)
);

create index if not exists property_payment_allocations_charge_idx
  on public.property_payment_allocations (property_charge_id);

alter table public.property_payment_allocations enable row level security;

drop policy if exists "Authenticated users can read property payment allocations"
  on public.property_payment_allocations;
create policy "Authenticated users can read property payment allocations"
  on public.property_payment_allocations
  for select to authenticated
  using (true);

insert into public.property_payment_allocations (
  payment_id,
  property_charge_id,
  allocated_amount,
  allocation_note
)
values
  (35, '63a385b1-90e6-4e7f-8053-7b78b3dcdf78', 1000.00,
   'Receipt-supported historical Sticker / ID Fee allocation'),
  (36, '94d5f0e5-c13b-4396-82ed-8c13f651a3eb', 1000.00,
   'Receipt-supported historical Sticker / ID Fee allocation'),
  (753, 'b473dd23-c9ec-405a-a2f2-dca8ff091c0e', 150.00,
   'Receipt-supported historical Sticker / ID Fee allocation'),
  (754, '63a754e0-8990-457e-9a1c-08c0253600a9', 450.00,
   'Receipt-supported historical Document / Certification Fee allocation'),
  (755, '53723541-a171-4da8-bca4-1deedafa8613', 345.00,
   'Receipt-supported historical Special Assessment allocation'),
  (756, 'f62a6229-f7b3-4d11-bdfb-0fd2640e4706', 200.00,
   'Receipt-supported historical Penalty / Late Fee allocation')
on conflict (payment_id, property_charge_id) do nothing;
