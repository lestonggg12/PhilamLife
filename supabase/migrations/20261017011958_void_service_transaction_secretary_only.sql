CREATE OR REPLACE FUNCTION public.void_service_transaction(
  p_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.service_transactions%rowtype;
BEGIN
  IF coalesce(public.current_user_role(), '') <> 'secretary' THEN
    RAISE EXCEPTION 'Only the Secretary can void service receipts.';
  END IF;

  IF length(btrim(coalesce(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION
      'A reason is required to void a receipt (at least 5 characters).';
  END IF;

  SELECT *
    INTO r
    FROM public.service_transactions
   WHERE id = p_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found.';
  END IF;

  IF lower(coalesce(r.payment_status, 'paid')) = 'voided' THEN
    RAISE EXCEPTION 'Receipt % is already voided.', r.receipt_number;
  END IF;

  IF r.balance_of IS NULL AND EXISTS (
    SELECT 1
      FROM public.service_transactions x
     WHERE x.balance_of = r.id
       AND lower(coalesce(x.payment_status, 'paid')) <> 'voided'
  ) THEN
    RAISE EXCEPTION
      'Receipt % has balance payments. Void those first.',
      r.receipt_number;
  END IF;

  UPDATE public.service_transactions
     SET payment_status = 'voided',
         voided_at = now(),
         voided_by = auth.uid(),
         void_reason = btrim(p_reason)
   WHERE id = p_id;
END;
$function$;
