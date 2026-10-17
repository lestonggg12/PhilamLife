CREATE OR REPLACE FUNCTION public.sync_balance_on_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  effect numeric(12,2);
BEGIN
  IF new.property_id IS NULL THEN
    RETURN new;
  END IF;

  effect := greatest(
    coalesce(new.balance_effect, new.amount_paid, new.amount, 0)
      - coalesce(new.effect_released, 0),
    0
  );

  IF old.status <> 'Voided' AND new.status = 'Voided' THEN
    UPDATE public.properties
       SET current_balance = current_balance + effect
     WHERE id = new.property_id;
  ELSIF old.status = 'Voided' AND new.status <> 'Voided' THEN
    UPDATE public.properties
       SET current_balance = current_balance - effect
     WHERE id = new.property_id;
  END IF;

  RETURN new;
END;
$function$;
