-- Already applied to the connected mock-data Supabase project as 20261112121216.
-- Protect receipt-to-bank-deposit evidence against later source void/amount edits.
-- Do NOT rerun this migration on the already-migrated project.
CREATE OR REPLACE FUNCTION public.guard_linked_deposit_receipt_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $guard$
BEGIN
 IF TG_TABLE_NAME = 'payments' THEN
   IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
       OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method)
     AND EXISTS (SELECT 1 FROM public.bank_deposit_receipt_links l WHERE l.active AND l.payment_id=OLD.id)
   THEN
     RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unlink this homeowner receipt from bank deposits before changing its financial status or paid amount.';
   END IF;
 ELSIF TG_TABLE_NAME = 'service_transactions' THEN
   IF (NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.voided_at IS DISTINCT FROM OLD.voided_at
       OR NEW.amount_paid IS DISTINCT FROM OLD.amount_paid OR NEW.payment_method IS DISTINCT FROM OLD.payment_method)
     AND EXISTS (SELECT 1 FROM public.bank_deposit_receipt_links l WHERE l.active AND l.service_transaction_id=OLD.id)
   THEN
     RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unlink this service receipt from bank deposits before changing its payment status or paid amount.';
   END IF;
 END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.guard_linked_deposit_receipt_changes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_bank_deposit_linked_payment_change
BEFORE UPDATE OF status,voided_at,amount_paid,amount,payment_method ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_deposit_receipt_changes();
CREATE TRIGGER guard_bank_deposit_linked_service_change
BEFORE UPDATE OF payment_status,voided_at,amount_paid,payment_method ON public.service_transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_linked_deposit_receipt_changes();
