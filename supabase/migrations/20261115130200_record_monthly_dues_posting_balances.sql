-- Future-only posting-time audit for monthly Association Dues.
-- This does not modify any historical charges, balances, payments, or existing audit events.
-- Fires after the existing balance and CCTV adjustment triggers.

create or replace function system_notification_private.capture_monthly_dues_posting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_after numeric(12,2);
  v_adjustments numeric(12,2);
  v_before numeric(12,2);
begin
  if new.charge_type is distinct from 'Association Dues'
    or new.billing_month is null
    or new.voided_at is not null
    or new.amount <= 0 then
    return new;
  end if;

  -- The existing apply_charge_to_balance AFTER INSERT trigger has run.
  -- The zz_cctv_electricity_charge trigger has also posted any linked credit.
  select p.current_balance into strict v_after
    from public.properties p where p.id = new.property_id;

  -- The only insert-time linked adjustment is the existing CCTV compensation.
  -- Its balance_effect is signed (negative for credit) and already affects v_after.
  select coalesce(sum(a.balance_effect), 0)::numeric(12,2)
    into v_adjustments
    from public.account_adjustments a
    where a.charge_id = new.id
      and a.property_id = new.property_id
      and a.adjustment_type = 'credit'
      and a.approval_reference like 'CCTV:%'
      and a.reversed_at is null;

  v_before := v_after - new.amount - v_adjustments;

  -- Bell notifications are disabled; the existing permanent account_activity
  -- journal receives one uniquely keyed posting snapshot per new charge.
  perform system_notification_private.emit_event(
    'monthly_billing_posted:' || new.id::text,
    'monthly_billing_posted',
    'Monthly billing balance recorded',
    'Posting-time account balance captured for ' ||
      to_char(new.billing_month, 'FMMonth YYYY') || ' association dues.',
    array[new.property_id],
    jsonb_build_object(
      'snapshot_version', 1,
      'source_table', 'property_charges',
      'source_id', new.id,
      'property_id', new.property_id,
      'billing_month', new.billing_month,
      'charge_amount', new.amount,
      'balance_before', v_before,
      'billing_time_adjustments', v_adjustments,
      'balance_after', v_after,
      'captured_at', clock_timestamp(),
      'recording_basis', 'posting_time_triggers'
    ),
    null, new.created_at, '/homeowners/' || new.property_id, false
  );
  return new;
end;
$function$;

revoke execute on function system_notification_private.capture_monthly_dues_posting()
from public, anon, authenticated;

create trigger zzzzzz_capture_monthly_dues_posting
  after insert on public.property_charges
  for each row execute function system_notification_private.capture_monthly_dues_posting();
