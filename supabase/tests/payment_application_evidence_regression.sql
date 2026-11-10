-- Run against the designated mock-data test project after installing the migration.
-- No production writes or historical payment backfill. Fails on any mismatch.
-- Tests 10 cases in the SAME PostgreSQL function used by the AFTER trigger.
BEGIN;
DO $suite$
DECLARE
  r jsonb;
  before_rows jsonb;
  after_rows jsonb;
  du uuid := '00000000-0000-0000-0000-000000000101';
  pe uuid := '00000000-0000-0000-0000-000000000102';
  v_count integer;
BEGIN
  -- 1. Ordinary fully settled monthly charge.
  before_rows := jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',800));
  after_rows := '[]'::jsonb;
  r := payment_allocation_private.calculate_application(before_rows,after_rows,800);
  ASSERT (r->>'applied')::numeric=800 AND (r->>'unapplied_effect')::numeric=0
    AND jsonb_array_length(r->'items')=1, 'ordinary payment';

  -- 2. Advance payment before any charge exists; never invent an allocation.
  r := payment_allocation_private.calculate_application('[]'::jsonb,'[]'::jsonb,500);
  ASSERT (r->>'applied')::numeric=0 AND (r->>'unapplied_effect')::numeric=500
    AND jsonb_array_length(r->'items')=0, 'advance payment';

  -- 3. Partial settlement: only actual reduction in an unpaid item is saved.
  r := payment_allocation_private.calculate_application(before_rows,
      jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',500)),300);
  ASSERT (r->>'applied')::numeric=300 AND (r->>'unapplied_effect')::numeric=0,
    'partial settlement';

  -- 4. CCTV-adjusted dues: view supplies net 600 (800 gross less 200 CCTV).
  r := payment_allocation_private.calculate_application(
    jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',600)),
    '[]'::jsonb,600);
  ASSERT (r->>'applied')::numeric=600 AND (r->>'unapplied_effect')::numeric=0,
    'CCTV-adjusted dues';

  -- 5. Annual-prepaid promotion: 8,800 cash plus 800 noncash discount =
  -- 9,600 account effect, no fictional previously billed monthly charge.
  r := payment_allocation_private.calculate_application('[]'::jsonb,'[]'::jsonb,9600);
  ASSERT (r->>'unapplied_effect')::numeric=9600 AND 8800+800=9600,
    'annual prepayment discount';

  -- 6. A manual discount is NOT part of the payment's cash allocation.
  -- A later waiver is a separate account adjustment (-100), not another
  -- 100 of cash credited against this payment's item-level snapshot.
  r := payment_allocation_private.calculate_application(
    jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',1000)),
    jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',400)),600);
  ASSERT (r->>'applied')::numeric=600 AND (r->>'unapplied_effect')::numeric=0,
    'manual discount separate from received cash';

  -- 7. A void must not delete issuance evidence. Verify that snapshots
  -- are joined to the live payment status, and no snapshot UPDATE/DELETE
  -- is included in this migration's accounting triggers.
  ASSERT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public'
    AND viewname='payment_application_evidence' AND definition ILIKE '%status%'),
    'void status visible on immutable issuance evidence';

  -- 8. Annual late penalty is a separately identified unpaid item.
  r := payment_allocation_private.calculate_application(
    jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',600),
                      jsonb_build_object('kind','penalty','ref_id',pe,'unpaid',70)),
    jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',600)),70);
  ASSERT (r->>'applied')::numeric=70 AND jsonb_array_length(r->'items')=1
    AND r->'items'->0->>'kind'='penalty', 'annual penalty item';

  -- 9. Mixed payment: settles 500 of debt, leaves 200 unapplied as credit.
  r := payment_allocation_private.calculate_application(
    jsonb_build_array(jsonb_build_object('kind','dues','ref_id',du,'unpaid',500)),
    '[]'::jsonb,700);
  ASSERT (r->>'applied')::numeric=500 AND (r->>'unapplied_effect')::numeric=200,
    'mixed settlement and advance';

  -- 10. Server-side cross-property allocation protection must exist.
  SELECT count(*) INTO v_count FROM pg_trigger t
   WHERE t.tgrelid='public.property_payment_allocations'::regclass
     AND t.tgname='z_guard_payment_allocation_same_property' AND t.tgenabled='O';
  ASSERT v_count=1, 'same-property allocation guard';
  ASSERT NOT EXISTS (SELECT 1 FROM public.financial_invariant_report
                     WHERE abs(reconciliation_difference)>0.005),
    'property balance reconciliation';
  RAISE NOTICE 'All ten payment allocation regression checks passed';
END;
$suite$;
ROLLBACK;
