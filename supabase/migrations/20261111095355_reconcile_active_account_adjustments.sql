-- PhilamLife mock/test database: reconcile active account adjustments.
-- Restore the proven complete view definition instead of string-matching
-- pg_get_viewdef output (which differs across Postgres versions/environments).
-- Reporting view only: does not change payment, charge, or property balance rows.
-- Preserves the original view's columns and security_invoker=true.
CREATE OR REPLACE VIEW public.payment_charge_allocation_audit
WITH (security_invoker = true)
AS
WITH charges AS (
  SELECT property_charges.property_id,
    COALESCE(property_charges.charge_type, 'Association Dues'::text) AS charge_type,
    sum(property_charges.amount)::numeric(12,2) AS charged_amount,
    count(*)::integer AS charge_count
  FROM property_charges
  WHERE property_charges.voided_at IS NULL
  GROUP BY property_charges.property_id, COALESCE(property_charges.charge_type, 'Association Dues'::text)
), payments AS (
  SELECT payments.property_id,
    COALESCE(payments.charge_type, 'Association Dues'::text) AS charge_type,
    sum(COALESCE(payments.amount_paid, payments.amount))::numeric(12,2) AS cash_received,
    sum(GREATEST(COALESCE(payments.balance_effect, 0::numeric) - COALESCE(payments.effect_released, 0::numeric), 0::numeric))::numeric(12,2) AS applied_amount,
    count(*)::integer AS payment_count
  FROM public.payments
  WHERE payments.status IS DISTINCT FROM 'Voided'::text AND payments.property_id IS NOT NULL
  GROUP BY payments.property_id, COALESCE(payments.charge_type, 'Association Dues'::text)
), explicit_allocations AS (
  SELECT c.property_id,
    COALESCE(c.charge_type, 'Association Dues'::text) AS charge_type,
    sum(a.allocated_amount)::numeric(12,2) AS explicit_allocated_amount,
    count(*)::integer AS explicit_allocation_count
  FROM property_payment_allocations a
  JOIN property_charges c ON c.id = a.property_charge_id
  JOIN public.payments p ON p.id = a.payment_id AND p.status IS DISTINCT FROM 'Voided'::text
  WHERE c.voided_at IS NULL
  GROUP BY c.property_id, COALESCE(c.charge_type, 'Association Dues'::text)
), combined AS (
  SELECT COALESCE(c.property_id, p.property_id) AS property_id,
    COALESCE(c.charge_type, p.charge_type) AS charge_type,
    COALESCE(c.charged_amount, 0::numeric)::numeric(12,2) AS charged_amount,
    COALESCE(c.charge_count, 0) AS charge_count,
    COALESCE(p.cash_received, 0::numeric)::numeric(12,2) AS cash_received,
    COALESCE(p.applied_amount, 0::numeric)::numeric(12,2) AS applied_amount,
    COALESCE(p.payment_count, 0) AS payment_count
  FROM charges c
  FULL JOIN payments p ON p.property_id = c.property_id AND p.charge_type = c.charge_type
), property_totals AS (
  SELECT combined.property_id,
    sum(combined.charged_amount)::numeric(12,2) AS property_charged_amount,
    sum(combined.applied_amount)::numeric(12,2) AS property_applied_amount
  FROM combined
  GROUP BY combined.property_id
), context AS (
  SELECT combined.property_id,
    combined.charge_type,
    combined.charged_amount,
    combined.charge_count,
    combined.cash_received,
    combined.applied_amount,
    combined.payment_count,
    COALESCE(p.opening_balance, 0::numeric)::numeric(12,2) AS opening_balance,
    COALESCE(p.current_balance, 0::numeric)::numeric(12,2) AS current_balance,
    COALESCE(p.homeowner_status, 'active'::text) AS homeowner_status,
    property_totals.property_charged_amount,
    property_totals.property_applied_amount,
    COALESCE(a.advance_cash_received, 0::numeric)::numeric(12,2) AS advance_cash_received,
    COALESCE(a.advance_payment_count, 0) AS advance_payment_count,
    COALESCE(e.explicit_allocated_amount, 0::numeric)::numeric(12,2) AS explicit_allocated_amount,
    COALESCE(e.explicit_allocation_count, 0) AS explicit_allocation_count
  FROM combined
  JOIN property_totals USING (property_id)
  LEFT JOIN properties p ON p.id = combined.property_id
  LEFT JOIN (
    SELECT payments.property_id,
      sum(COALESCE(payments.amount_paid, payments.amount))::numeric(12,2) AS advance_cash_received,
      count(*)::integer AS advance_payment_count
    FROM public.payments
    WHERE payments.status IS DISTINCT FROM 'Voided'::text
      AND lower(COALESCE(payments.coverage_period, ''::text)) LIKE '%advance%'
    GROUP BY payments.property_id
  ) a USING (property_id)
  LEFT JOIN explicit_allocations e ON e.property_id = combined.property_id AND e.charge_type = combined.charge_type
), classified AS (
  SELECT context.property_id,
    context.charge_type,
    context.charged_amount,
    context.charge_count,
    context.cash_received,
    context.applied_amount,
    context.payment_count,
    context.opening_balance,
    context.current_balance,
    context.homeowner_status,
    context.property_charged_amount,
    context.property_applied_amount,
    context.advance_cash_received,
    context.advance_payment_count,
    context.explicit_allocated_amount,
    context.explicit_allocation_count,
    (context.opening_balance + context.property_charged_amount - context.property_applied_amount
      + COALESCE((SELECT sum(adj.balance_effect)
          FROM public.account_adjustments adj
          WHERE adj.property_id = context.property_id AND adj.reversed_at IS NULL), 0::numeric))::numeric(12,2)
      AS expected_current_balance
  FROM context
)
SELECT property_id,
  charge_type,
  charged_amount,
  applied_amount,
  GREATEST(charged_amount - applied_amount, 0::numeric)::numeric(12,2) AS unpaid_amount,
  cash_received,
  GREATEST(cash_received - applied_amount, 0::numeric)::numeric(12,2) AS unallocated_amount,
  charge_count,
  payment_count,
  CASE
    WHEN abs(expected_current_balance - current_balance) > 0.005 AND homeowner_status <> 'active'::text THEN 'inactive_property_balance_mismatch'::text
    WHEN abs(expected_current_balance - current_balance) > 0.005 THEN 'property_balance_mismatch'::text
    WHEN cash_received > applied_amount + 0.005 THEN 'cash_partially_unallocated'::text
    WHEN charged_amount > applied_amount + 0.005 THEN 'charge_partially_unpaid'::text
    WHEN current_balance < -0.005 AND advance_payment_count > 0 THEN 'documented_advance_credit'::text
    WHEN charged_amount = 0::numeric AND cash_received > 0::numeric THEN 'payment_without_charge'::text
    ELSE 'property_reconciles_allocation_unproven'::text
  END AS allocation_status,
  opening_balance,
  property_charged_amount,
  property_applied_amount,
  current_balance,
  expected_current_balance,
  (expected_current_balance - current_balance)::numeric(12,2) AS reconciliation_difference,
  homeowner_status,
  GREATEST(-current_balance, 0::numeric)::numeric(12,2) AS property_credit,
  advance_payment_count,
  advance_cash_received,
  explicit_allocated_amount,
  explicit_allocation_count,
  CASE WHEN explicit_allocation_count > 0 THEN 'explicit'::text ELSE 'inferred'::text END AS allocation_basis
FROM classified;
