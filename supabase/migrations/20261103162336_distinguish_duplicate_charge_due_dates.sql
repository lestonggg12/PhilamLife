-- Preserve duplicate prevention while allowing different final due dates.
CREATE OR REPLACE FUNCTION public.reject_duplicate_charge_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  uid uuid := auth.uid();
  existing uuid;
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('dup-charge:' ||
      coalesce(NEW.property_id::text, '-') || ':' || uid::text)
  );

  SELECT c.id INTO existing
  FROM public.property_charges c
  WHERE c.created_by = uid
    AND c.property_id IS NOT DISTINCT FROM NEW.property_id
    AND c.charge_type = NEW.charge_type
    AND c.amount = NEW.amount
    AND coalesce(c.description, '') = coalesce(NEW.description, '')
    AND c.billing_month IS NOT DISTINCT FROM NEW.billing_month
    AND c.due_date IS NOT DISTINCT FROM NEW.due_date
    AND c.voided_at IS NULL
    AND c.created_at > now() - interval '15 seconds'
  LIMIT 1;

  IF existing IS NOT NULL THEN
    RAISE EXCEPTION USING errcode = '23505',
      message = 'This charge was already added a moment ago. If you really need a second identical charge, wait 15 seconds and try again.';
  END IF;

  RETURN NEW;
END
$function$;