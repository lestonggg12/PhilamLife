-- Enrich future automatic monthly-billing completion notices with actual
-- charge-journal evidence, including credits posted DURING billing (CCTV).
-- No existing charges, balances, payments, or historical notifications change.
CREATE OR REPLACE FUNCTION system_notification_private.enrich_monthly_billing_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_month date;
  v_collection_date date;
  v_snapshot system_notification_private.collection_snapshots%rowtype;
  v_stats record;
  v_current_outstanding numeric;
  v_prior_credit numeric;
  v_new_credit numeric;
  v_bad_events integer;
  v_excluded integer;
  v_month_label text;
BEGIN
  -- Only ordinary, successful, system-generated completion notices.
  -- Never reinterpret historical charge-only verifications or warning reports.
  IF NEW.kind IS DISTINCT FROM 'collection_run'
    OR NEW.dedupe_key NOT LIKE 'collection_run:%'
    OR coalesce(NEW.payload->>'evidence_scope','') <> ''
    OR coalesce((NEW.payload->>'snapshot_missing')::boolean,false) THEN
    RETURN NEW;
  END IF;

  v_collection_date := (NEW.payload->>'collection_date')::date;
  IF v_collection_date IS NULL THEN RETURN NEW; END IF;
  v_month := date_trunc('month', v_collection_date)::date;
  SELECT * INTO v_snapshot
  FROM system_notification_private.collection_snapshots
  WHERE collection_date = v_collection_date;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Reconcile journal events to newly created charges, one row per charge.
  -- A CCTV compensation can create credit after the snapshot and before the
  -- notifications; using the snapshot alone would undercount these credits.
  WITH billed AS (
    SELECT c.id, c.property_id, c.amount, p.property_classification,
      s.balance AS balance_before,
      coalesce((SELECT sum((a.payload->>'credit_used')::numeric)
        FROM public.account_activity a
        WHERE a.kind='credit_applied'
          AND a.payload->>'source_id'=c.id::text
          AND a.payload->>'billing_month'=v_month::text),0) AS credit_used,
      coalesce((SELECT sum((a.payload->>'unpaid_added')::numeric)
        FROM public.account_activity a
        WHERE a.kind='monthly_balance_added'
          AND a.payload->>'source_id'=c.id::text
          AND a.payload->>'billing_month'=v_month::text),0) AS unpaid_added
    FROM public.property_charges c
    JOIN public.properties p ON p.id=c.property_id
    JOIN jsonb_to_recordset(v_snapshot.accounts)
      AS s(property_id bigint,balance numeric,already_billed boolean)
      ON s.property_id=c.property_id
    WHERE c.charge_type='Association Dues' AND c.billing_month=v_month
      AND c.voided_at IS NULL AND c.created_at>=v_snapshot.captured_at
      AND c.created_by_name='System (automatic)' AND NOT s.already_billed
  ), computed AS (
    SELECT *, least(credit_used,greatest(-balance_before,0)) AS prior_credit_used,
      greatest(credit_used-least(credit_used,greatest(-balance_before,0)),0) AS during_credit_used
    FROM billed
  )
  SELECT count(*)::integer AS billed_accounts,
    count(*) FILTER (WHERE property_classification='homeowner')::integer AS homeowners,
    count(*) FILTER (WHERE property_classification='lot_owner')::integer AS lot_owners,
    count(*) FILTER (WHERE property_classification='unclassified')::integer AS unclassified,
    coalesce(sum(amount),0) AS assessed,
    count(*) FILTER (WHERE credit_used>0)::integer AS credit_accounts,
    count(*) FILTER (WHERE credit_used>=amount AND amount>0)::integer AS fully_covered,
    count(*) FILTER (WHERE credit_used>0 AND credit_used<amount)::integer AS partly_covered,
    coalesce(sum(credit_used),0) AS credit_total,
    coalesce(sum(prior_credit_used),0) AS credit_prior,
    coalesce(sum(during_credit_used),0) AS credit_during,
    count(*) FILTER (WHERE unpaid_added>0)::integer AS new_unpaid_accounts,
    coalesce(sum(unpaid_added),0) AS new_unpaid_amount,
    count(*) FILTER (WHERE abs(amount-credit_used-unpaid_added)>0.005)::integer AS bad_events
  INTO v_stats FROM computed;

  SELECT count(*) INTO v_excluded
  FROM jsonb_to_recordset(v_snapshot.accounts)
    AS s(property_id bigint,expected_dues numeric,already_billed boolean)
  WHERE coalesce(s.expected_dues,0)<=0 OR coalesce(s.already_billed,false);

  SELECT coalesce(sum(greatest(current_balance,0)),0)
  INTO v_current_outstanding
  FROM public.properties WHERE homeowner_status='active';

  -- Never show a verified success if its underlying event amounts do not match.
  IF v_stats.bad_events>0 THEN
    NEW.title:='Monthly Billing Needs Review — '||to_char(v_collection_date,'FMMonth YYYY');
    NEW.body:=format('%s new monthly-dues charges have incomplete credit/unpaid allocation evidence. Review the Monthly Billing Audit before relying on the completion totals.',v_stats.bad_events);
    NEW.severity:='warning';
    NEW.payload:=NEW.payload||jsonb_build_object(
      'report_version',2,'allocation_evidence_incomplete',true,
      'unverified_charges',v_stats.bad_events,'billed_accounts',v_stats.billed_accounts);
    RETURN NEW;
  END IF;

  v_month_label:=to_char(v_collection_date,'FMMonth YYYY');
  v_prior_credit:=v_stats.credit_prior;
  v_new_credit:=v_stats.credit_during;
  NEW.title:='Monthly Billing Applied — '||v_month_label;
  NEW.body:=format(
    '%s association dues were assessed for %s accounts (%s homeowners, %s lot owners, %s unclassified), totaling %s. '||
    'Credits applied to these charges: %s across %s accounts (%s from advance balances before billing; %s from credits generated during billing, including eligible CCTV compensation). '||
    'Of those accounts, %s charges were fully covered by credit and %s were partly covered. '||
    'New unpaid portions of this month''s charges: %s across %s accounts. '||
    'Total outstanding across all active accounts at reporting time: %s (may include older unpaid balances). '||
    '%s accounts in the pre-billing snapshot were not newly billed (already billed or had no positive dues). '||
    'These are assessments and account credits, not new cash receipts.',
    v_month_label,v_stats.billed_accounts,v_stats.homeowners,v_stats.lot_owners,v_stats.unclassified,
    system_notification_private.peso(v_stats.assessed),
    system_notification_private.peso(v_stats.credit_total),v_stats.credit_accounts,
    system_notification_private.peso(v_prior_credit),system_notification_private.peso(v_new_credit),
    v_stats.fully_covered,v_stats.partly_covered,
    system_notification_private.peso(v_stats.new_unpaid_amount),v_stats.new_unpaid_accounts,
    system_notification_private.peso(v_current_outstanding),v_excluded);

  NEW.payload:=NEW.payload||jsonb_build_object(
    'report_version',2,'billing_month',v_month,
    'billed_accounts',v_stats.billed_accounts,
    'billed_homeowners',v_stats.homeowners,'billed_lot_owners',v_stats.lot_owners,
    'billed_unclassified',v_stats.unclassified,'excluded_snapshot_accounts',v_excluded,
    'assessed_total',v_stats.assessed,
    'assessed_total_formatted',system_notification_private.peso(v_stats.assessed),
    'credit_accounts',v_stats.credit_accounts,
    'fully_covered',v_stats.fully_covered,'partly_covered',v_stats.partly_covered,
    'credit_deducted',v_stats.credit_total,
    'credit_deducted_formatted',system_notification_private.peso(v_stats.credit_total),
    'prebilling_credit_used',v_prior_credit,'during_billing_credit_used',v_new_credit,
    'new_unpaid_accounts',v_stats.new_unpaid_accounts,'new_unpaid_amount',v_stats.new_unpaid_amount,
    'new_unpaid_formatted',system_notification_private.peso(v_stats.new_unpaid_amount),
    'current_total_outstanding',v_current_outstanding,
    'current_total_outstanding_formatted',system_notification_private.peso(v_current_outstanding),
    'allocation_evidence_incomplete',false);
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION system_notification_private.enrich_monthly_billing_report()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_enrich_monthly_billing_report ON public.notifications;
CREATE TRIGGER a_enrich_monthly_billing_report
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION system_notification_private.enrich_monthly_billing_report();
