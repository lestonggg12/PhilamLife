-- A property may have monthly dues and separate fees in the same month.
-- Keep one charge per property, month, and charge type.
alter table public.property_charges
  drop constraint if exists property_charges_property_id_billing_month_key;

alter table public.property_charges
  add constraint property_charges_property_id_billing_month_charge_type_key
  unique (property_id, billing_month, charge_type);
