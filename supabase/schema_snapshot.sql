-- PhilamLife public schema snapshot, generated from the live Supabase DB on 2026-10-08.
-- REFERENCE ONLY: keep this outside supabase/migrations/. Functions and views are not
-- included (they live in migrations). Tables below depend on these functions existing:
-- current_user_role(), next_service_receipt_number(), hoa_manila_today().

-- ============ TABLES ============
create table if not exists public.account_adjustments (
  id uuid not null default gen_random_uuid(),
  property_id bigint not null,
  charge_id uuid,
  adjustment_type text not null,
  balance_effect numeric(12,2) not null,
  reason text not null,
  approval_reference text not null,
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  reversed_at timestamp with time zone,
  reversed_by uuid,
  reversal_reason text
);
create table if not exists public.accounting_periods (
  id uuid not null default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open'::text,
  closed_at timestamp with time zone,
  closed_by uuid,
  close_note text,
  reopened_at timestamp with time zone,
  reopened_by uuid,
  reopen_reason text,
  created_at timestamp with time zone not null default now()
);
create table if not exists public.activity_log (
  id bigint not null,
  user_id uuid not null,
  action text not null,
  target text,
  created_at timestamp with time zone default now()
);
create table if not exists public.amenity_services (
  id uuid not null default gen_random_uuid(),
  name text not null,
  description text,
  rate numeric(12,2) not null default 0,
  rate_unit text not null default 'per use'::text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create table if not exists public.bank_deposits (
  id uuid not null default gen_random_uuid(),
  fund_id uuid not null,
  deposit_date date not null,
  bank_reference text not null,
  amount numeric(12,2) not null,
  status text not null default 'pending'::text,
  recorded_by uuid not null,
  recorded_at timestamp with time zone not null default now(),
  cleared_at timestamp with time zone
);
create table if not exists public.blocks (
  id bigint not null,
  name text not null,
  created_at timestamp with time zone default now()
);
create table if not exists public.collection_actions (
  id uuid not null default gen_random_uuid(),
  property_id bigint not null,
  action_type text not null,
  action_date timestamp with time zone not null default now(),
  details text not null,
  document_reference text,
  created_by uuid not null
);
create table if not exists public.documents (
  id uuid not null default gen_random_uuid(),
  title text not null,
  category text not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  uploaded_by uuid default auth.uid(),
  uploaded_by_name text not null,
  created_at timestamp with time zone not null default now()
);
create table if not exists public.events (
  id uuid not null default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  start_time time without time zone,
  end_time time without time zone,
  location text,
  created_by uuid not null default auth.uid(),
  created_by_name text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create table if not exists public.expenses (
  id uuid not null default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  description text not null,
  amount numeric(12,2) not null,
  reference_number text,
  recorded_by uuid not null,
  recorded_by_name text not null,
  created_at timestamp with time zone not null default now(),
  status text not null default 'Completed'::text
);
create table if not exists public.moved_account_reconciliations (
  id uuid not null default gen_random_uuid(),
  property_id bigint not null,
  adjustment_amount numeric(12,2) not null,
  reason text not null,
  recorded_at timestamp with time zone not null default now()
);
create table if not exists public.payment_allocations (
  id uuid not null default gen_random_uuid(),
  payment_id bigint not null,
  charge_id uuid not null,
  amount numeric(12,2) not null,
  allocated_by uuid not null,
  allocated_at timestamp with time zone not null default now(),
  reversed_at timestamp with time zone,
  reversed_by uuid,
  reversal_reason text
);
create table if not exists public.payments (
  id bigint not null,
  property_id bigint,
  amount numeric not null,
  status text not null default 'Completed'::text,
  payment_date date,
  recorded_by uuid,
  created_at timestamp with time zone default now(),
  paid_at timestamp with time zone not null default now(),
  amount_paid numeric(12,2),
  receipt_number text,
  homeowner_name text,
  block_name text,
  lot_number text,
  coverage_period text,
  previous_balance numeric(12,2),
  remaining_balance numeric(12,2),
  payment_method text,
  reference_number text,
  note text,
  recorded_by_name text,
  charge_type text,
  balance_effect numeric(12,2),
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text,
  effect_released numeric(12,2) not null default 0
);
create table if not exists public.profiles (
  id uuid not null,
  full_name text not null,
  role text not null,
  created_at timestamp with time zone default now(),
  email text,
  is_active boolean not null default true,
  updated_at timestamp with time zone not null default now()
);
create table if not exists public.properties (
  id bigint not null,
  block text not null,
  lot_number integer not null,
  homeowner_name text,
  created_at timestamp with time zone default now(),
  contact_phone text,
  contact_email text,
  contact_updated_at timestamp with time zone,
  homeowner_status text not null default 'active'::text,
  status_effective_date date,
  status_reason text,
  status_updated_at timestamp with time zone,
  current_balance numeric(12,2) not null default 0,
  opening_balance numeric(12,2),
  opening_balance_as_of date,
  opening_balance_note text
);
create table if not exists public.property_charges (
  id uuid not null default gen_random_uuid(),
  property_id bigint not null,
  charge_type text not null,
  description text,
  amount numeric(12,2) not null,
  billing_month date,
  created_by uuid,
  created_by_name text,
  created_at timestamp with time zone not null default now(),
  voided_at timestamp with time zone,
  voided_by uuid,
  void_reason text
);
create table if not exists public.property_payment_allocations (
  id uuid not null default gen_random_uuid(),
  payment_id bigint not null,
  property_charge_id uuid not null,
  allocated_amount numeric(12,2) not null,
  allocation_note text not null,
  created_by uuid,
  created_at timestamp with time zone not null default now()
);
create table if not exists public.service_transactions (
  id uuid not null default gen_random_uuid(),
  receipt_number text not null default next_service_receipt_number(),
  service_id uuid not null,
  service_name text not null,
  customer_name text not null,
  block_name text not null,
  lot_number text not null,
  service_date date not null,
  start_time time without time zone,
  quantity integer not null default 1,
  amount_due numeric(12,2) not null,
  amount_paid numeric(12,2) not null,
  payment_method text not null,
  reference_number text,
  notes text,
  payment_status text not null,
  recorded_by uuid not null,
  recorded_by_name text not null,
  paid_at timestamp with time zone not null default now(),
  property_id bigint,
  balance_of uuid
);
create table if not exists public.system_settings (
  id integer not null default 1,
  hoa_name text not null default 'PHILAM Village'::text,
  address text not null default 'Cagayan de Oro City, Philippines'::text,
  contact_email text,
  contact_phone text,
  dues_amount numeric(12,2) not null default 5000,
  due_day integer not null default 5,
  grace_period_days integer not null default 0,
  late_penalty numeric(12,2) not null default 0,
  email_on_payment boolean not null default true,
  email_on_overdue boolean not null default true,
  sms_reminders boolean not null default false,
  weekly_digest boolean not null default true,
  reminder_days_before integer not null default 3,
  require_strong_password boolean not null default true,
  session_timeout integer not null default 30,
  two_factor boolean not null default false,
  currency text not null default 'PHP'::text,
  timezone text not null default 'Asia/Manila'::text,
  date_format text not null default 'MM/DD/YYYY'::text,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  billing_day smallint not null default 1
);
create table if not exists public.user_management_logs (
  id bigint not null,
  actor_id uuid,
  actor_name text,
  target_user_id uuid,
  target_user_name text,
  action text not null,
  details text,
  created_at timestamp with time zone not null default now()
);
create table if not exists public.violations (
  id uuid not null default gen_random_uuid(),
  property_id bigint,
  category text not null default 'Other'::text,
  description text not null,
  status text not null default 'Open'::text,
  fine_amount numeric(12,2) default 0,
  fine_collected boolean not null default false,
  date_issued date not null default hoa_manila_today(),
  date_resolved date,
  notes text,
  created_by uuid not null,
  created_by_name text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ============ PRIMARY KEYS / UNIQUE / CHECKS ============
alter table public.account_adjustments add constraint account_adjustments_pkey PRIMARY KEY (id);
alter table public.account_adjustments add constraint account_adjustments_adjustment_type_check CHECK ((adjustment_type = ANY (ARRAY['credit'::text, 'waiver'::text, 'write_off'::text, 'refund'::text, 'debit_correction'::text, 'credit_correction'::text, 'reversal'::text])));
alter table public.account_adjustments add constraint account_adjustments_approval_reference_check CHECK ((length(TRIM(BOTH FROM approval_reference)) > 0));
alter table public.account_adjustments add constraint account_adjustments_balance_effect_check CHECK ((balance_effect <> (0)::numeric));
alter table public.account_adjustments add constraint account_adjustments_reason_check CHECK ((length(TRIM(BOTH FROM reason)) >= 5));
alter table public.accounting_periods add constraint accounting_periods_pkey PRIMARY KEY (id);
alter table public.accounting_periods add constraint accounting_periods_check CHECK ((ends_on >= starts_on));
alter table public.accounting_periods add constraint accounting_periods_starts_on_ends_on_key UNIQUE (starts_on, ends_on);
alter table public.accounting_periods add constraint accounting_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
alter table public.activity_log add constraint activity_log_pkey PRIMARY KEY (id);
alter table public.amenity_services add constraint amenity_services_pkey PRIMARY KEY (id);
alter table public.amenity_services add constraint amenity_services_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0));
alter table public.amenity_services add constraint amenity_services_name_key UNIQUE (name);
alter table public.amenity_services add constraint amenity_services_rate_check CHECK ((rate >= (0)::numeric));
alter table public.amenity_services add constraint amenity_services_rate_unit_check CHECK ((rate_unit = ANY (ARRAY['per use'::text, 'per hour'::text, 'per person'::text, 'per day'::text])));
alter table public.bank_deposits add constraint bank_deposits_pkey PRIMARY KEY (id);
alter table public.bank_deposits add constraint bank_deposits_amount_check CHECK ((amount > (0)::numeric));
alter table public.bank_deposits add constraint bank_deposits_fund_id_bank_reference_key UNIQUE (fund_id, bank_reference);
alter table public.bank_deposits add constraint bank_deposits_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'cleared'::text, 'reconciled'::text, 'voided'::text])));
alter table public.blocks add constraint blocks_pkey PRIMARY KEY (id);
alter table public.blocks add constraint blocks_name_key UNIQUE (name);
alter table public.collection_actions add constraint collection_actions_pkey PRIMARY KEY (id);
alter table public.collection_actions add constraint collection_actions_action_type_check CHECK ((action_type = ANY (ARRAY['statement_sent'::text, 'reminder_sent'::text, 'delinquency_notice'::text, 'dispute_opened'::text, 'hearing_scheduled'::text, 'resolved'::text, 'Phone Call'::text, 'Email Sent'::text, 'Formal Notice'::text, 'Payment Plan Arranged'::text, 'Site Visit'::text, 'Other'::text])));
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents add constraint documents_category_check CHECK ((category = ANY (ARRAY['Minutes'::text, 'Reports'::text, 'Legal'::text, 'Announcements'::text, 'Forms'::text, 'Other'::text])));
alter table public.documents add constraint documents_file_size_check CHECK (((file_size > 0) AND (file_size <= 10485760)));
alter table public.documents add constraint documents_mime_type_check CHECK ((length(btrim(mime_type)) > 0));
alter table public.documents add constraint documents_original_file_name_check CHECK (((length(btrim(original_file_name)) >= 1) AND (length(btrim(original_file_name)) <= 255)));
alter table public.documents add constraint documents_storage_path_check CHECK ((storage_path ~~ 'documents/%'::text));
alter table public.documents add constraint documents_storage_path_key UNIQUE (storage_path);
alter table public.documents add constraint documents_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 160)));
alter table public.documents add constraint documents_uploaded_by_name_check CHECK (((length(btrim(uploaded_by_name)) >= 1) AND (length(btrim(uploaded_by_name)) <= 160)));
alter table public.events add constraint events_pkey PRIMARY KEY (id);
alter table public.events add constraint events_created_by_name_check CHECK (((length(btrim(created_by_name)) >= 1) AND (length(btrim(created_by_name)) <= 160)));
alter table public.events add constraint events_description_check CHECK (((description IS NULL) OR ((length(btrim(description)) >= 1) AND (length(btrim(description)) <= 1000))));
alter table public.events add constraint events_location_check CHECK (((location IS NULL) OR ((length(btrim(location)) >= 1) AND (length(btrim(location)) <= 160))));
alter table public.events add constraint events_time_range_check CHECK (((end_time IS NULL) OR ((start_time IS NOT NULL) AND (end_time > start_time))));
alter table public.events add constraint events_title_check CHECK (((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 160)));
alter table public.expenses add constraint expenses_pkey PRIMARY KEY (id);
alter table public.expenses add constraint expenses_amount_check CHECK ((amount > (0)::numeric));
alter table public.expenses add constraint expenses_category_check CHECK ((length(TRIM(BOTH FROM category)) > 0));
alter table public.expenses add constraint expenses_description_check CHECK ((length(TRIM(BOTH FROM description)) > 0));
alter table public.expenses add constraint expenses_recorded_by_name_check CHECK ((length(TRIM(BOTH FROM recorded_by_name)) > 0));
alter table public.expenses add constraint expenses_status_check CHECK ((status = ANY (ARRAY['Completed'::text, 'Recorded'::text, 'Voided'::text])));
alter table public.moved_account_reconciliations add constraint moved_account_reconciliations_pkey PRIMARY KEY (id);
alter table public.moved_account_reconciliations add constraint moved_account_reconciliations_adjustment_amount_check CHECK ((adjustment_amount <> (0)::numeric));
alter table public.moved_account_reconciliations add constraint moved_account_reconciliations_property_id_key UNIQUE (property_id);
alter table public.payment_allocations add constraint payment_allocations_pkey PRIMARY KEY (id);
alter table public.payment_allocations add constraint payment_allocations_amount_check CHECK ((amount > (0)::numeric));
alter table public.payment_allocations add constraint payment_allocations_check CHECK ((((reversed_at IS NULL) AND (reversed_by IS NULL) AND (reversal_reason IS NULL)) OR ((reversed_at IS NOT NULL) AND (reversed_by IS NOT NULL) AND (length(TRIM(BOTH FROM reversal_reason)) > 0))));
alter table public.payment_allocations add constraint payment_allocations_payment_id_charge_id_key UNIQUE (payment_id, charge_id);
alter table public.payments add constraint payments_pkey PRIMARY KEY (id);
alter table public.payments add constraint payments_amount_paid_check CHECK ((amount_paid > (0)::numeric));
alter table public.payments add constraint payments_reference_check CHECK (((payment_method = 'Cash'::text) OR (NULLIF(TRIM(BOTH FROM reference_number), ''::text) IS NOT NULL)));
alter table public.payments add constraint payments_status_check CHECK ((status = ANY (ARRAY['Completed'::text, 'Voided'::text])));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_role_check CHECK ((lower(role) = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
alter table public.properties add constraint properties_pkey PRIMARY KEY (id);
alter table public.properties add constraint properties_homeowner_status_check CHECK ((homeowner_status = ANY (ARRAY['active'::text, 'moved'::text, 'transferred'::text])));
alter table public.property_charges add constraint property_charges_pkey PRIMARY KEY (id);
alter table public.property_charges add constraint property_charges_amount_check CHECK ((amount > (0)::numeric));
alter table public.property_charges add constraint property_charges_billing_month_check CHECK (((billing_month IS NULL) OR (billing_month = (date_trunc('month'::text, (billing_month)::timestamp with time zone))::date)));
alter table public.property_charges add constraint property_charges_charge_type_check CHECK ((charge_type = ANY (ARRAY['Association Dues'::text, 'Special Assessment'::text, 'Penalty / Late Fee'::text, 'Sticker / ID Fee'::text, 'Document / Certification Fee'::text, 'Other'::text])));
alter table public.property_charges add constraint property_charges_description_check CHECK (((description IS NULL) OR (length(btrim(description)) <= 250)));
alter table public.property_charges add constraint property_charges_dues_are_automatic CHECK (((charge_type <> 'Association Dues'::text) OR (billing_month IS NOT NULL)));
alter table public.property_charges add constraint property_charges_property_id_billing_month_charge_type_key UNIQUE (property_id, billing_month, charge_type);
alter table public.property_payment_allocations add constraint property_payment_allocations_pkey PRIMARY KEY (id);
alter table public.property_payment_allocations add constraint property_payment_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric));
alter table public.property_payment_allocations add constraint property_payment_allocations_payment_id_property_charge_id_key UNIQUE (payment_id, property_charge_id);
alter table public.service_transactions add constraint service_transactions_pkey PRIMARY KEY (id);
alter table public.service_transactions add constraint service_transactions_amount_due_check CHECK ((amount_due > (0)::numeric));
alter table public.service_transactions add constraint service_transactions_amount_paid_check CHECK ((amount_paid > (0)::numeric));
alter table public.service_transactions add constraint service_transactions_block_name_check CHECK ((length(TRIM(BOTH FROM block_name)) > 0));
alter table public.service_transactions add constraint service_transactions_check CHECK ((((payment_status = 'paid'::text) AND (amount_paid >= amount_due)) OR ((payment_status = 'partial'::text) AND (amount_paid < amount_due))));
alter table public.service_transactions add constraint service_transactions_customer_name_check CHECK ((length(TRIM(BOTH FROM customer_name)) > 0));
alter table public.service_transactions add constraint service_transactions_lot_number_check CHECK ((length(TRIM(BOTH FROM lot_number)) > 0));
alter table public.service_transactions add constraint service_transactions_paid_not_over_due CHECK ((amount_paid <= amount_due));
alter table public.service_transactions add constraint service_transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['Cash'::text, 'GCash'::text, 'Bank Transfer'::text, 'Check'::text])));
alter table public.service_transactions add constraint service_transactions_quantity_check CHECK ((quantity > 0));
alter table public.service_transactions add constraint service_transactions_receipt_number_key UNIQUE (receipt_number);
alter table public.service_transactions add constraint service_transactions_recorded_by_name_check CHECK ((length(TRIM(BOTH FROM recorded_by_name)) > 0));
alter table public.service_transactions add constraint service_transactions_service_name_check CHECK ((length(TRIM(BOTH FROM service_name)) > 0));
alter table public.system_settings add constraint system_settings_pkey PRIMARY KEY (id);
alter table public.system_settings add constraint system_settings_billing_day_check CHECK (((billing_day >= 1) AND (billing_day <= 31)));
alter table public.system_settings add constraint system_settings_due_day_check CHECK (((due_day >= 1) AND (due_day <= 31)));
alter table public.system_settings add constraint system_settings_dues_amount_check CHECK ((dues_amount >= (0)::numeric));
alter table public.system_settings add constraint system_settings_grace_period_days_check CHECK ((grace_period_days >= 0));
alter table public.system_settings add constraint system_settings_id_check CHECK ((id = 1));
alter table public.system_settings add constraint system_settings_late_penalty_check CHECK ((late_penalty >= (0)::numeric));
alter table public.system_settings add constraint system_settings_reminder_days_before_check CHECK ((reminder_days_before >= 0));
alter table public.system_settings add constraint system_settings_session_timeout_check CHECK (((session_timeout >= 5) AND (session_timeout <= 1440)));
alter table public.user_management_logs add constraint user_management_logs_pkey PRIMARY KEY (id);
alter table public.violations add constraint violations_pkey PRIMARY KEY (id);
alter table public.violations add constraint violations_category_check CHECK ((category = ANY (ARRAY['Property Maintenance'::text, 'Parking'::text, 'Noise'::text, 'Architectural'::text, 'Other'::text])));
alter table public.violations add constraint violations_description_check CHECK ((length(TRIM(BOTH FROM description)) > 0));
alter table public.violations add constraint violations_fine_amount_check CHECK ((fine_amount >= (0)::numeric));
alter table public.violations add constraint violations_status_check CHECK ((status = ANY (ARRAY['Open'::text, 'Resolved'::text, 'Dismissed'::text])));

-- ============ FOREIGN KEYS ============
alter table public.account_adjustments add constraint account_adjustments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.account_adjustments add constraint account_adjustments_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT;
alter table public.account_adjustments add constraint account_adjustments_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES auth.users(id);
alter table public.accounting_periods add constraint accounting_periods_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES auth.users(id);
alter table public.accounting_periods add constraint accounting_periods_reopened_by_fkey FOREIGN KEY (reopened_by) REFERENCES auth.users(id);
alter table public.activity_log add constraint activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
alter table public.amenity_services add constraint amenity_services_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.bank_deposits add constraint bank_deposits_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id);
alter table public.collection_actions add constraint collection_actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.collection_actions add constraint collection_actions_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT;
alter table public.documents add constraint documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.events add constraint events_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE RESTRICT;
alter table public.expenses add constraint expenses_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id);
alter table public.moved_account_reconciliations add constraint moved_account_reconciliations_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT;
alter table public.payment_allocations add constraint payment_allocations_allocated_by_fkey FOREIGN KEY (allocated_by) REFERENCES auth.users(id);
alter table public.payment_allocations add constraint payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
alter table public.payment_allocations add constraint payment_allocations_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES auth.users(id);
alter table public.payments add constraint payments_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
alter table public.payments add constraint payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES profiles(id);
alter table public.payments add constraint payments_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id);
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);
alter table public.property_charges add constraint property_charges_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.property_charges add constraint property_charges_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
alter table public.property_charges add constraint property_charges_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES auth.users(id);
alter table public.property_payment_allocations add constraint property_payment_allocations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.property_payment_allocations add constraint property_payment_allocations_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
alter table public.property_payment_allocations add constraint property_payment_allocations_property_charge_id_fkey FOREIGN KEY (property_charge_id) REFERENCES property_charges(id) ON DELETE RESTRICT;
alter table public.service_transactions add constraint service_transactions_balance_of_fkey FOREIGN KEY (balance_of) REFERENCES service_transactions(id);
alter table public.service_transactions add constraint service_transactions_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE RESTRICT;
alter table public.service_transactions add constraint service_transactions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES auth.users(id);
alter table public.service_transactions add constraint service_transactions_service_id_fkey FOREIGN KEY (service_id) REFERENCES amenity_services(id);
alter table public.system_settings add constraint system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.user_management_logs add constraint user_management_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.user_management_logs add constraint user_management_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.violations add constraint violations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.violations add constraint violations_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;

-- ============ INDEXES ============
CREATE INDEX account_adjustments_property_idx ON public.account_adjustments USING btree (property_id, created_at DESC);
CREATE INDEX activity_log_created_at_id_idx ON public.activity_log USING btree (created_at DESC, id);
CREATE INDEX activity_log_user_id_idx ON public.activity_log USING btree (user_id);
CREATE INDEX collection_actions_property_id_idx ON public.collection_actions USING btree (property_id);
CREATE INDEX documents_uploaded_by_idx ON public.documents USING btree (uploaded_by);
CREATE INDEX events_created_by_idx ON public.events USING btree (created_by);
CREATE INDEX events_event_date_start_time_idx ON public.events USING btree (event_date, start_time);
CREATE INDEX expenses_expense_date_id_idx ON public.expenses USING btree (expense_date DESC, id);
CREATE INDEX expenses_expense_date_idx ON public.expenses USING btree (expense_date DESC);
CREATE INDEX expenses_status_idx ON public.expenses USING btree (status);
CREATE INDEX payment_allocations_charge_idx ON public.payment_allocations USING btree (charge_id) WHERE (reversed_at IS NULL);
CREATE INDEX payments_paid_at_id_idx ON public.payments USING btree (paid_at DESC, id);
CREATE INDEX payments_property_id_idx ON public.payments USING btree (property_id);
CREATE INDEX payments_property_paid_at_idx ON public.payments USING btree (property_id, paid_at DESC, id);
CREATE INDEX payments_recorded_by_idx ON public.payments USING btree (recorded_by);
CREATE INDEX properties_homeowner_status_idx ON public.properties USING btree (homeowner_status);
CREATE INDEX property_charges_billing_month_idx ON public.property_charges USING btree (billing_month);
CREATE INDEX property_charges_property_idx ON public.property_charges USING btree (property_id);
CREATE INDEX property_payment_allocations_charge_idx ON public.property_payment_allocations USING btree (property_charge_id);
CREATE INDEX service_transactions_balance_of_idx ON public.service_transactions USING btree (balance_of) WHERE (balance_of IS NOT NULL);
CREATE INDEX service_transactions_paid_at_idx ON public.service_transactions USING btree (paid_at DESC);
CREATE INDEX service_transactions_property_id_idx ON public.service_transactions USING btree (property_id);
CREATE INDEX service_transactions_service_id_idx ON public.service_transactions USING btree (service_id);
CREATE INDEX user_management_logs_created_at_idx ON public.user_management_logs USING btree (created_at DESC);
CREATE INDEX user_management_logs_target_user_idx ON public.user_management_logs USING btree (target_user_id);
CREATE INDEX violations_property_id_idx ON public.violations USING btree (property_id);
CREATE INDEX violations_status_idx ON public.violations USING btree (status);
CREATE UNIQUE INDEX payments_receipt_number_unique ON public.payments USING btree (receipt_number) WHERE (receipt_number IS NOT NULL);
CREATE UNIQUE INDEX properties_one_active_homeowner_per_lot_idx ON public.properties USING btree (lower(btrim(block)), lot_number) WHERE (COALESCE(homeowner_status, 'active'::text) = 'active'::text);

-- ============ ROW LEVEL SECURITY ============
alter table public.account_adjustments enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.activity_log enable row level security;
alter table public.amenity_services enable row level security;
alter table public.bank_deposits enable row level security;
alter table public.blocks enable row level security;
alter table public.collection_actions enable row level security;
alter table public.documents enable row level security;
alter table public.events enable row level security;
alter table public.expenses enable row level security;
alter table public.moved_account_reconciliations enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payments enable row level security;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.property_charges enable row level security;
alter table public.property_payment_allocations enable row level security;
alter table public.service_transactions enable row level security;
alter table public.system_settings enable row level security;
alter table public.user_management_logs enable row level security;
alter table public.violations enable row level security;

-- ============ POLICIES ============
create policy "Active staff can view events" on public.events as permissive for SELECT to authenticated
  using ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (lower(profiles.role) = ANY (ARRAY['admin'::text, 'treasurer'::text, 'secretary'::text])) AND (profiles.is_active = true)))));
create policy "Admin and Secretary can create blocks" on public.blocks as permissive for INSERT to authenticated
  with check ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can create properties" on public.properties as permissive for INSERT to authenticated
  with check ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can delete blocks" on public.blocks as permissive for DELETE to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can delete documents" on public.documents as permissive for DELETE to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can delete properties" on public.properties as permissive for DELETE to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can log violations" on public.violations as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text])) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy "Admin and Secretary can update blocks" on public.blocks as permissive for UPDATE to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])))
  with check ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can update properties" on public.properties as permissive for UPDATE to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])))
  with check ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Secretary can update violations" on public.violations as permissive for UPDATE to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])))
  with check ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text])));
create policy "Admin and Treasurer can view expenses" on public.expenses as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'treasurer'::text])));
create policy "Admin can update system settings" on public.system_settings as permissive for UPDATE to authenticated
  using ((current_user_role() = 'admin'::text))
  with check ((current_user_role() = 'admin'::text));
create policy "Admin can view user management logs" on public.user_management_logs as permissive for SELECT to authenticated
  using ((current_user_role() = 'admin'::text));
create policy "Admin, Secretary and Treasurer can view documents" on public.documents as permissive for SELECT to authenticated
  using ((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Admin, Secretary and Treasurer can view violations" on public.violations as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Admin, Secretary, and Treasurer can create payments" on public.payments as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])) AND (recorded_by = ( SELECT auth.uid() AS uid))));
create policy "Authenticated users can read moved account reconciliations" on public.moved_account_reconciliations as permissive for SELECT to authenticated
  using (true);
create policy "Authenticated users can read payment allocations" on public.payment_allocations as permissive for SELECT to authenticated
  using (true);
create policy "Authenticated users can read property payment allocations" on public.property_payment_allocations as permissive for SELECT to authenticated
  using (true);
create policy "Authorized roles can view activity log" on public.activity_log as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "HOA staff can read account_adjustments" on public.account_adjustments as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "HOA staff can read accounting_periods" on public.accounting_periods as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "HOA staff can read bank_deposits" on public.bank_deposits as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "HOA staff can read collection_actions" on public.collection_actions as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Secretary and Treasurer can update payments" on public.payments as permissive for UPDATE to authenticated
  using ((current_user_role() = ANY (ARRAY['secretary'::text, 'treasurer'::text])))
  with check ((current_user_role() = ANY (ARRAY['secretary'::text, 'treasurer'::text])));
create policy "Secretary can create amenity services" on public.amenity_services as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = 'secretary'::text) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy "Secretary can delete events" on public.events as permissive for DELETE to authenticated
  using ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (lower(profiles.role) = 'secretary'::text) AND (profiles.is_active = true)))));
create policy "Secretary can record service transactions" on public.service_transactions as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = 'secretary'::text) AND (recorded_by = ( SELECT auth.uid() AS uid))));
create policy "Secretary can schedule events" on public.events as permissive for INSERT to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (lower(profiles.role) = 'secretary'::text) AND (profiles.is_active = true))))));
create policy "Secretary can update amenity services" on public.amenity_services as permissive for UPDATE to authenticated
  using ((current_user_role() = 'secretary'::text))
  with check ((current_user_role() = 'secretary'::text));
create policy "Secretary can update events" on public.events as permissive for UPDATE to authenticated
  using ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (lower(profiles.role) = 'secretary'::text) AND (profiles.is_active = true)))))
  with check ((EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = ( SELECT auth.uid() AS uid)) AND (lower(profiles.role) = 'secretary'::text) AND (profiles.is_active = true)))));
create policy "Secretary can upload documents" on public.documents as permissive for INSERT to authenticated
  with check (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (( SELECT current_user_role() AS current_user_role) = 'secretary'::text)));
create policy "Staff can add manual charges" on public.property_charges as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])) AND (created_by = ( SELECT auth.uid() AS uid)) AND (billing_month IS NULL) AND (voided_at IS NULL)));
create policy "Staff can create own activity" on public.activity_log as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])) AND (user_id = ( SELECT auth.uid() AS uid))));
create policy "Staff can record collection actions" on public.collection_actions as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])) AND (created_by = ( SELECT auth.uid() AS uid))));
create policy "Staff can view amenity services" on public.amenity_services as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view blocks" on public.blocks as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view charges" on public.property_charges as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view payments" on public.payments as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view profiles" on public.profiles as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view properties" on public.properties as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view service transactions" on public.service_transactions as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can view system settings" on public.system_settings as permissive for SELECT to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Staff can void charges" on public.property_charges as permissive for UPDATE to authenticated
  using ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])))
  with check ((current_user_role() = ANY (ARRAY['admin'::text, 'secretary'::text, 'treasurer'::text])));
create policy "Treasurer can record expenses" on public.expenses as permissive for INSERT to authenticated
  with check (((( SELECT current_user_role() AS current_user_role) = 'treasurer'::text) AND (recorded_by = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['Completed'::text, 'Recorded'::text]))));
create policy "Treasurer can void expenses" on public.expenses as permissive for UPDATE to authenticated
  using (((current_user_role() = 'treasurer'::text) AND (status = ANY (ARRAY['Completed'::text, 'Recorded'::text]))))
  with check (((current_user_role() = 'treasurer'::text) AND (status = 'Voided'::text)));

-- ============ TRIGGERS ============
CREATE TRIGGER apply_charge_to_balance AFTER INSERT OR UPDATE OF voided_at ON public.property_charges FOR EACH ROW EXECUTE FUNCTION apply_charge_to_balance();
CREATE TRIGGER check_service_balance_payment BEFORE INSERT ON public.service_transactions FOR EACH ROW EXECUTE FUNCTION check_service_balance_payment();
CREATE TRIGGER prepare_payment_before_insert BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION prepare_payment_record();
CREATE TRIGGER protect_amenity_service_audit_fields BEFORE UPDATE ON public.amenity_services FOR EACH ROW EXECUTE FUNCTION protect_amenity_service_audit_fields();
CREATE TRIGGER protect_expense_audit_fields BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION protect_expense_audit_fields();
CREATE TRIGGER protect_payment_financial_fields BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION protect_payment_financial_fields();
CREATE TRIGGER protect_property_balance BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION protect_property_balance();
CREATE TRIGGER protect_property_charge_fields BEFORE UPDATE ON public.property_charges FOR EACH ROW EXECUTE FUNCTION protect_property_charge_fields();
CREATE TRIGGER set_profile_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_profile_updated_at();
CREATE TRIGGER sync_balance_on_payment_status AFTER UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION sync_balance_on_payment_status();
CREATE TRIGGER system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION update_system_settings_timestamp();
CREATE TRIGGER validate_property_payment_allocation_trigger BEFORE INSERT OR UPDATE ON public.property_payment_allocations FOR EACH ROW EXECUTE FUNCTION validate_property_payment_allocation();
CREATE TRIGGER violations_set_updated_at BEFORE UPDATE ON public.violations FOR EACH ROW EXECUTE FUNCTION set_updated_at();