-- CCTV credits are non-cash reductions earned for a SPECIFIC dues month.
-- Previously the account balance reconciled, but property_balance_items treated
-- CCTV adjustments as generic credits, potentially paying older overdue dues.
-- Never alter historical charges, credits, payments, or penalty assessments.
-- This migration changes only the allocation VIEW used by future penalty runs.
DO $cctv_allocation$
DECLARE
  v_view text;
  v_charge_anchor text := '            c.amount,' || chr(10) || '            lp.anniversary_no,';
  v_where_anchor text := '          WHERE c.voided_at IS NULL';
  v_adjustment_anchor text := 'a.adjustment_type <> ''monthly_dues_reprice''::text';
  v_updated text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.account_adjustments a
      LEFT JOIN public.property_effective_charges c
        ON c.id=a.charge_id AND c.property_id=a.property_id
    WHERE a.adjustment_type='credit' AND a.approval_reference LIKE 'CCTV:%'
      AND a.reversed_at IS NULL AND
        (c.id IS NULL OR c.charge_type <> 'Association Dues'
         OR c.billing_month IS NULL OR -a.balance_effect > c.amount
         OR a.balance_effect >= 0)
  ) THEN
    RAISE EXCEPTION 'CCTV credit and monthly charge records require review before changing penalty allocation.';
  END IF;

  v_view := pg_get_viewdef('public.property_balance_items'::regclass, true);
  -- Fail closed if a newer database definition differs. Rewriting a different
  -- view must never silently change financial calculations.
  IF (length(v_view)-length(replace(v_view,v_charge_anchor,''))) <> length(v_charge_anchor)
     OR (length(v_view)-length(replace(v_view,v_where_anchor,''))) <> length(v_where_anchor)
     OR (length(v_view)-length(replace(v_view,v_adjustment_anchor,''))) <> length(v_adjustment_anchor)
  THEN
    RAISE EXCEPTION 'Property balance allocation view changed: review CCTV migration against the live schema.';
  END IF;

  v_updated := replace(v_view,v_charge_anchor,
    '            (c.amount - coalesce(cctv.linked_credit, 0::numeric))::numeric(12,2) AS amount,'
    || chr(10) || '            lp.anniversary_no,');

  v_updated := replace(v_updated,v_where_anchor,
    '          LEFT JOIN LATERAL (' || chr(10) ||
    '            SELECT coalesce(sum(-a.balance_effect), 0::numeric) AS linked_credit' || chr(10) ||
    '            FROM public.account_adjustments a' || chr(10) ||
    '            WHERE a.charge_id=c.id AND a.property_id=c.property_id' || chr(10) ||
    '              AND a.adjustment_type=''credit'' AND a.approval_reference LIKE ''CCTV:%''' || chr(10) ||
    '              AND a.reversed_at IS NULL' || chr(10) ||
    '          ) cctv ON c.charge_type=''Association Dues''' || chr(10) ||
    v_where_anchor);

  -- Its amount was deducted at the matching dues charge above. It must NOT
  -- also enter the free-floating account credit pool (double deduction).
  v_updated := replace(v_updated,v_adjustment_anchor,
    v_adjustment_anchor || chr(10) ||
    '            AND NOT (a.adjustment_type=''credit'' AND a.approval_reference LIKE ''CCTV:%'' AND a.charge_id IS NOT NULL)');

  EXECUTE 'CREATE OR REPLACE VIEW public.property_balance_items AS ' || v_updated;
  -- Check the view's accounting invariant for ALL accounts, not only CCTV lots.
  IF EXISTS (
    SELECT 1 FROM public.properties p
    LEFT JOIN (SELECT property_id, sum(unpaid) AS remaining
               FROM public.property_balance_items GROUP BY property_id) i
      ON i.property_id=p.id
    WHERE abs(coalesce(i.remaining,0) - greatest(p.current_balance,0)) > 0.005
  ) THEN
    RAISE EXCEPTION 'Unpaid-dues allocation does not reconcile. Migration rolled back.';
  END IF;
END
$cctv_allocation$;

-- Store the non-cash CCTV credits that EXISTED before each new payment, for
-- transparent receipt disclosure. This is not a payment discount and does not
-- reduce cash received, the saved payment effect or the printed cash total.
CREATE OR REPLACE FUNCTION public.receipt_breakdown_for(p_property_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $receipt$
  SELECT jsonb_build_object(
    'entered_balance', b.entered_balance_unpaid,
    'penalties_count', b.penalties_posted_count,
    'penalties_rated_count', b.penalties_rated_count,
    'penalties_posted_total', b.penalties_posted_total,
    'penalties_outstanding', b.penalties_outstanding,
    'rate_min', b.penalty_rate_min,
    'rate_max', b.penalty_rate_max,
    'unpaid_dues', b.unpaid_dues_total,
    'unpaid_dues_months', b.unpaid_dues_months,
    'total_due', b.grand_total_due,
    'entry_lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('category',x.category,'as_of',x.item_date,
                       'description',x.label,'original',x.original,'unpaid',x.unpaid) ORDER BY x.item_date),'[]'::jsonb)
                    FROM public.property_balance_items x WHERE x.property_id=p_property_id
                       AND x.kind='entry' AND x.unpaid>0),
    'penalty_lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('no',x.penalty_no,'date',x.item_date,
                       'rate',x.rate,'base',x.base_amount,'amount',x.original,'unpaid',x.unpaid)
                       ORDER BY x.item_date,x.penalty_no),'[]'::jsonb)
                    FROM public.property_balance_items x WHERE x.property_id=p_property_id AND x.kind='penalty'),
    'cctv_credit_snapshot',
      (SELECT jsonb_build_object('total',coalesce(sum(-a.balance_effect),0), 'months',count(*))
       FROM public.account_adjustments a
       JOIN public.property_charges c ON c.id=a.charge_id AND c.property_id=a.property_id
       WHERE a.property_id=p_property_id AND a.adjustment_type='credit'
         AND a.approval_reference LIKE 'CCTV:%' AND a.reversed_at IS NULL
         AND c.charge_type='Association Dues' AND c.voided_at IS NULL)
  ) FROM public.homeowner_balance_breakdown b WHERE b.property_id=p_property_id;
$receipt$;

COMMENT ON FUNCTION public.receipt_breakdown_for(bigint) IS
  'Immutable-at-issuance payment balance breakdown, including already-posted CCTV non-cash credits. New snapshots do not change past receipts.';
