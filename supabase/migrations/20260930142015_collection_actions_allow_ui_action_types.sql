alter table public.collection_actions drop constraint if exists collection_actions_action_type_check;

alter table public.collection_actions add constraint collection_actions_action_type_check check (
  action_type in (
    'statement_sent', 'reminder_sent', 'delinquency_notice',
    'dispute_opened', 'hearing_scheduled', 'resolved',
    'Phone Call', 'Email Sent', 'Formal Notice',
    'Payment Plan Arranged', 'Site Visit', 'Other'
  )
);
