CREATE TABLE IF NOT EXISTS public.receipt_note_amendments (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 payment_id bigint NOT NULL REFERENCES public.payments(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 previous_note text,
 new_note text,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 5 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipt_note_amendments_payment_idx ON public.receipt_note_amendments(payment_id,created_at DESC,id DESC);
ALTER TABLE public.receipt_note_amendments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_note_amendments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.receipt_note_amendments TO authenticated;
DROP POLICY IF EXISTS receipt_note_amendments_staff_read ON public.receipt_note_amendments;
CREATE POLICY receipt_note_amendments_staff_read ON public.receipt_note_amendments
 FOR SELECT TO authenticated
 USING ((SELECT public.current_user_role()) IN ('admin','secretary','treasurer'));
CREATE OR REPLACE FUNCTION public.guard_receipt_note_amendment()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
 IF NEW.note IS NOT DISTINCT FROM OLD.note THEN RETURN NEW; END IF;
 IF current_user <> 'postgres'
 OR current_setting('app.receipt_note_amendment',true) IS DISTINCT FROM 'authorized'
 OR auth.uid() IS NULL OR public.current_user_role() <> 'secretary'
 OR OLD.status <> 'Completed' OR NEW.status IS DISTINCT FROM OLD.status
 THEN RAISE EXCEPTION USING ERRCODE='42501',
 MESSAGE='Completed payment notes can only be corrected through the audited Secretary amendment action.';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_receipt_note_amendment() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzzz_guard_receipt_note_amendment ON public.payments;
CREATE TRIGGER zzzz_guard_receipt_note_amendment BEFORE UPDATE OF note ON public.payments
 FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_note_amendment();
CREATE OR REPLACE FUNCTION public.amend_completed_receipt_note(p_payment_id bigint,p_new_note text,p_reason text)
RETURNS public.receipt_note_amendments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_existing public.payments%rowtype;
 v_amendment public.receipt_note_amendments%rowtype;
 v_actor uuid := auth.uid();
 v_new_note text := nullif(btrim(p_new_note),'');
 v_reason text := btrim(p_reason);
BEGIN
 IF v_actor IS NULL OR public.current_user_role() <> 'secretary' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Only an active Secretary may amend completed receipt notes.';
 END IF;
 IF p_payment_id IS NULL OR v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500 OR length(coalesce(v_new_note,''))>250 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='An existing receipt, a reason of 5–500 characters, and a note of at most 250 characters are required.';
 END IF;
 SELECT * INTO v_existing FROM public.payments WHERE id=p_payment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='Receipt not found.'; END IF;
 IF v_existing.status <> 'Completed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only completed receipts may have note amendments.'; END IF;
 IF v_existing.note IS NOT DISTINCT FROM v_new_note THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='The corrected note must differ from the current note.';
 END IF;
 PERFORM set_config('app.receipt_note_amendment','authorized',true);
 UPDATE public.payments SET note=v_new_note WHERE id=p_payment_id;
 INSERT INTO public.receipt_note_amendments(payment_id,actor_id,previous_note,new_note,reason)
 VALUES(p_payment_id,v_actor,v_existing.note,v_new_note,v_reason) RETURNING * INTO v_amendment;
 INSERT INTO public.activity_log(user_id,action,target)
 VALUES(v_actor,'Receipt Note Amended',
  format('%s — correction reason: %s',coalesce(v_existing.receipt_number,'Payment #'||p_payment_id::text),v_reason));
 PERFORM set_config('app.receipt_note_amendment','',true);
 RETURN v_amendment;
END $fn$;
REVOKE ALL ON FUNCTION public.amend_completed_receipt_note(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.amend_completed_receipt_note(bigint,text,text) TO authenticated;
COMMENT ON FUNCTION public.amend_completed_receipt_note(bigint,text,text) IS
 'Secretary-only correction of an immutable completed receipt note with reason and mandatory structured/activity audit.';
