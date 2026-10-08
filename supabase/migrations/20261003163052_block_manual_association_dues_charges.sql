-- Association Dues are billed only by the monthly job (bill_monthly_dues), which always sets billing_month.
-- A dues charge without a billing month can only come from a manual entry, so reject it.
alter table public.property_charges
  add constraint property_charges_dues_are_automatic
  check (charge_type <> 'Association Dues' or billing_month is not null);
