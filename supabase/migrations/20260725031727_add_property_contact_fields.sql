alter table public.properties
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists contact_updated_at timestamp with time zone;

comment on column public.properties.contact_phone is
  'Homeowner contact phone number.';

comment on column public.properties.contact_email is
  'Homeowner contact email address.';

comment on column public.properties.contact_updated_at is
  'Most recent date and time the homeowner contact details were changed.';
