-- Additive, Secretary-only soft deletion of amenities/services.
-- Keep all service IDs and historical receipts intact.
ALTER TABLE public.amenity_services
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.profiles(id);

ALTER TABLE public.amenity_services
  ADD CONSTRAINT amenity_service_archive_evidence
  CHECK ((archived_at IS NULL AND archived_by IS NULL)
      OR (archived_at IS NOT NULL AND archived_by IS NOT NULL));

-- Prevent app clients from hard-deleting services or directly changing archival evidence.
REVOKE DELETE ON TABLE public.amenity_services FROM authenticated;
REVOKE UPDATE ON TABLE public.amenity_services FROM authenticated;
GRANT UPDATE (name, description, rate, rate_unit, is_active, kids_rate)
  ON TABLE public.amenity_services TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_archived_amenity_service()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF OLD.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'This service was removed and cannot be edited. Create a new service instead.';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_archived_amenity_service() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER prevent_archived_amenity_service_edits
  BEFORE UPDATE ON public.amenity_services
  FOR EACH ROW EXECUTE FUNCTION public.guard_archived_amenity_service();

CREATE OR REPLACE FUNCTION public.archive_amenity_service(p_service_id uuid)
RETURNS public.amenity_services
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  result public.amenity_services%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.current_user_role() IS DISTINCT FROM 'secretary' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only an active Secretary can remove services.';
  END IF;
  IF p_service_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Choose a service to remove.';
  END IF;
  SELECT * INTO result FROM public.amenity_services WHERE id=p_service_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='The service no longer exists.';
  END IF;
  IF result.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='This service has already been removed.';
  END IF;
  UPDATE public.amenity_services
    SET is_active=false, archived_at=clock_timestamp(), archived_by=auth.uid()
    WHERE id=p_service_id RETURNING * INTO result;
  PERFORM public.write_audit_log('Amenity Service Removed', result.name || ' (' || result.id || ')');
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.archive_amenity_service(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_amenity_service(uuid) TO authenticated;
