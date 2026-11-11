-- Read-only, rollback-safe assertions for the consolidated properties policies.
BEGIN;
SET LOCAL statement_timeout = '30s';

DO $test$
DECLARE
  v_insert record;
  v_update record;
  v_select record;
BEGIN
  SELECT policyname, roles, with_check
    INTO STRICT v_insert
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'properties' AND cmd = 'INSERT';
  SELECT policyname, roles, qual, with_check
    INTO STRICT v_update
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'properties' AND cmd = 'UPDATE';
  SELECT policyname, roles, qual
    INTO STRICT v_select
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'properties' AND cmd = 'SELECT';

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'properties' AND cmd = 'INSERT') <> 1
    OR (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'properties' AND cmd = 'UPDATE') <> 1
  THEN
    RAISE EXCEPTION 'Overlapping properties policies remain.';
  END IF;

  IF v_insert.policyname <> 'Active staff can create properties'
    OR v_update.policyname <> 'Active staff can update properties'
    OR v_insert.roles <> '{authenticated}'::name[]
    OR v_update.roles <> '{authenticated}'::name[]
  THEN
    RAISE EXCEPTION 'Properties policy names or SQL roles are unexpected.';
  END IF;

  -- Both row checks must include exactly the same active staff roles.
  -- The catalogue renders IN expressions as '= ANY (ARRAY[...])'.
  IF v_insert.with_check IS NULL
    OR v_update.qual IS NULL
    OR v_update.with_check IS NULL
    OR v_insert.with_check NOT LIKE '%current_user_role()%'
    OR v_update.qual NOT LIKE '%current_user_role()%'
    OR v_update.with_check NOT LIKE '%current_user_role()%'
  THEN
    RAISE EXCEPTION 'Properties policy role checks are absent.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = 'properties'
      AND p.cmd IN ('INSERT','UPDATE')
      AND (
        position('admin' in coalesce(p.qual,'') || coalesce(p.with_check,'')) = 0 OR
        position('secretary' in coalesce(p.qual,'') || coalesce(p.with_check,'')) = 0 OR
        position('treasurer' in coalesce(p.qual,'') || coalesce(p.with_check,'')) = 0
      )
  ) THEN
    RAISE EXCEPTION 'A previously permitted staff role is missing.';
  END IF;

  IF v_select.policyname <> 'Staff can view properties' THEN
    RAISE EXCEPTION 'Properties SELECT policy unexpectedly changed.';
  END IF;
END
$test$;

ROLLBACK;
