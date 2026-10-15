-- Additive only: existing columns keep their names, order and meaning. dues_collected has always been
-- the total of ALL non-voided payments (dues + fees); the new columns split it so screens can be exact.
create or replace view public.monthly_collections with (security_invoker = true) as
with dues as (
  select (date_trunc('month', payments.paid_at at time zone 'Asia/Manila'))::date as month_start,
         coalesce(sum(coalesce(payments.amount_paid, payments.amount)), 0::numeric) as dues_collected,
         count(*)::integer as dues_receipts,
         coalesce(sum(coalesce(payments.amount_paid, payments.amount))
                  filter (where coalesce(payments.charge_type, 'Association Dues') = 'Association Dues'), 0::numeric) as dues_only_collected,
         (count(*) filter (where coalesce(payments.charge_type, 'Association Dues') = 'Association Dues'))::integer as dues_only_receipts,
         coalesce(sum(coalesce(payments.amount_paid, payments.amount))
                  filter (where coalesce(payments.charge_type, 'Association Dues') <> 'Association Dues'), 0::numeric) as fees_collected,
         (count(*) filter (where coalesce(payments.charge_type, 'Association Dues') <> 'Association Dues'))::integer as fees_receipts
    from public.payments
   where payments.status is distinct from 'Voided' and payments.paid_at is not null
   group by 1
), svc as (
  select (date_trunc('month', service_transactions.paid_at at time zone 'Asia/Manila'))::date as month_start,
         coalesce(sum(coalesce(service_transactions.amount_paid, 0::numeric)), 0::numeric) as service_collected,
         count(*)::integer as service_receipts
    from public.service_transactions
   where service_transactions.paid_at is not null
     and lower(coalesce(service_transactions.payment_status, 'paid')) <> 'voided'
   group by 1
)
select coalesce(d.month_start, s.month_start) as month_start,
       coalesce(d.dues_collected, 0::numeric) as dues_collected,
       coalesce(d.dues_receipts, 0) as dues_receipts,
       coalesce(s.service_collected, 0::numeric) as service_collected,
       coalesce(s.service_receipts, 0) as service_receipts,
       coalesce(d.dues_only_collected, 0::numeric) as dues_only_collected,
       coalesce(d.dues_only_receipts, 0) as dues_only_receipts,
       coalesce(d.fees_collected, 0::numeric) as fees_collected,
       coalesce(d.fees_receipts, 0) as fees_receipts
  from dues d
  full join svc s on d.month_start = s.month_start;

comment on column public.monthly_collections.dues_collected is 'TOTAL of all non-voided homeowner payments (dues + fees). Use dues_only_collected for dues alone.';

-- Settings changes (dues, billing day, penalty, security) were never written to the activity log.
create or replace function public.audit_settings_change()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare diff text;
begin
  select string_agg(n.key || ': ' || coalesce(o.value, 'empty') || ' → ' || coalesce(n.value, 'empty'), '; ' order by n.key)
    into diff
    from jsonb_each_text(to_jsonb(new)) n
    join jsonb_each_text(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value
     and n.key not in ('updated_at', 'updated_by');
  if diff is not null then
    perform public.write_audit_log('Settings Updated', left(diff, 500));
  end if;
  return new;
end $$;

create trigger audit_settings_change
  after update on public.system_settings
  for each row execute function public.audit_settings_change();;
