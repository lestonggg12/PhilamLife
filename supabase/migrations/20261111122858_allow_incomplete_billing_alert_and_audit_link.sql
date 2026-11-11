ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
 CHECK (kind IN ('collection_reminder','collection_run','collection_incomplete',
 'penalty_anniversary','transaction_voided','ownership_changed','settings_changed',
 'credit_applied','penalty_applied','monthly_balance_added','penalty_collected'));
ALTER TABLE public.notifications DROP CONSTRAINT notifications_link_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_link_check
 CHECK (link IN ('/overdue-accounts','/activity-log','/expenses','/system-settings')
 OR link ~ '^/homeowners/[1-9][0-9]*$'
 OR link ~ '^/billing-audit[?]month=[0-9]{4}-(0[1-9]|1[0-2])$');
