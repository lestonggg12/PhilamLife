-- Consolidate equivalent permissive policies without broadening staff permissions.
-- Existing INSERT/UPDATE rules allow active Admin, Secretary, or Treasurer.
-- The selected role still comes from current_user_role(), which rejects inactive profiles.

ALTER POLICY "Admin and Secretary can create properties"
  ON public.properties
  RENAME TO "Active staff can create properties";

ALTER POLICY "Active staff can create properties"
  ON public.properties
  WITH CHECK ((SELECT public.current_user_role()) IN ('admin', 'secretary', 'treasurer'));

DROP POLICY "Treasurer can create homeowner records" ON public.properties;

ALTER POLICY "Admin and Secretary can update properties"
  ON public.properties
  RENAME TO "Active staff can update properties";

ALTER POLICY "Active staff can update properties"
  ON public.properties
  USING ((SELECT public.current_user_role()) IN ('admin', 'secretary', 'treasurer'))
  WITH CHECK ((SELECT public.current_user_role()) IN ('admin', 'secretary', 'treasurer'));

DROP POLICY "Treasurer can edit homeowner details" ON public.properties;
