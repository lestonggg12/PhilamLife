CREATE OR REPLACE FUNCTION system_notification_private.reconcile_incomplete_monthly_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
 v_day integer; v_date date; v_month date;
 v_snap system_notification_private.collection_snapshots%rowtype;
 v_expected integer; v_posted integer; v_missing integer;
 v_verified boolean; v_key text;
BEGIN
 IF NEW.last_reminder_day IS NULL OR NEW.last_reminder_day < NEW.started_on THEN RETURN NEW; END IF;
 SELECT billing_day INTO STRICT v_day FROM public.system_settings WHERE id=1;
 FOR v_month IN SELECT x::date FROM generate_series(
    date_trunc('month',NEW.started_on)::timestamp,
    date_trunc('month',NEW.last_reminder_day)::timestamp,interval '1 month') AS x
 LOOP
  v_date := system_notification_private.collection_date(v_month,v_day);
  IF v_date < NEW.started_on OR v_date > NEW.last_reminder_day THEN CONTINUE; END IF;
  SELECT * INTO v_snap FROM system_notification_private.collection_snapshots WHERE collection_date=v_date;
  IF NOT FOUND THEN CONTINUE; END IF;
  WITH expected AS (
    SELECT s.property_id FROM jsonb_to_recordset(v_snap.accounts)
      AS s(property_id bigint,expected_dues numeric,already_billed boolean)
    WHERE s.expected_dues>0 AND NOT coalesce(s.already_billed,false)
  )
  SELECT count(*)::integer,count(*) FILTER(WHERE c.id IS NOT NULL)::integer
  INTO v_expected,v_posted
  FROM expected e LEFT JOIN public.property_charges c
    ON c.property_id=e.property_id AND c.billing_month=v_month
     AND c.charge_type='Association Dues' AND c.voided_at IS NULL
     AND c.created_at>=v_snap.captured_at AND c.created_by_name='System (automatic)';
  v_missing := v_expected-v_posted;
  v_key := 'collection_incomplete:'||v_date::text;
  SELECT EXISTS(SELECT 1 FROM public.notifications n WHERE n.kind='collection_run'
    AND n.dedupe_key='collection_run:'||v_date::text AND n.severity<>'warning'
    AND n.payload->>'report_version'='2'
    AND NOT coalesce((n.payload->>'allocation_evidence_incomplete')::boolean,false))
  INTO v_verified;
  IF v_missing>0 AND NOT v_verified THEN
    INSERT INTO public.notifications(kind,dedupe_key,title,body,severity,payload,link)
    VALUES('collection_incomplete',v_key,'Monthly Billing Incomplete — Needs Review',
      format('%s monthly dues are incomplete. %s of %s eligible accounts are billed; %s charges remain missing. No verified completion report is available. Check Monthly Billing Audit and the scheduled job logs, then retry billing.',
        to_char(v_date,'FMMonth YYYY'),v_posted,v_expected,v_missing),
      'warning',
      jsonb_build_object('collection_date',v_date,'billing_month',v_month,
        'expected_accounts',v_expected,'billed_accounts',v_posted,
        'missing_accounts',v_missing,'recovery_status','incomplete'),
      '/billing-audit?month='||to_char(v_month,'YYYY-MM'))
    ON CONFLICT (dedupe_key) DO UPDATE SET
      title=excluded.title,body=excluded.body,severity=excluded.severity,
      payload=excluded.payload,link=excluded.link
    WHERE public.notifications.payload IS DISTINCT FROM excluded.payload
       OR public.notifications.severity IS DISTINCT FROM excluded.severity;
  ELSIF v_missing=0 AND v_verified THEN
    UPDATE public.notifications n
    SET title='Monthly Billing Recovered — '||to_char(v_date,'FMMonth YYYY'),
      body=format('The incomplete %s monthly dues run has recovered. All %s eligible charges are posted and the verified completion report is available. See Monthly Billing Audit.',to_char(v_date,'FMMonth YYYY'),v_expected),
      severity='info',
      payload=n.payload||jsonb_build_object('recovery_status','recovered',
        'missing_accounts',0,'billed_accounts',v_posted,'verified_completion',true)
    WHERE n.dedupe_key=v_key AND n.kind='collection_incomplete'
      AND n.payload->>'recovery_status'='incomplete';
  END IF;
 END LOOP;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION system_notification_private.reconcile_incomplete_monthly_billing() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzzz_reconcile_incomplete_monthly_billing ON system_notification_private.state;
CREATE TRIGGER zzzz_reconcile_incomplete_monthly_billing
AFTER UPDATE OF last_reminder_day ON system_notification_private.state
FOR EACH ROW EXECUTE FUNCTION system_notification_private.reconcile_incomplete_monthly_billing();
