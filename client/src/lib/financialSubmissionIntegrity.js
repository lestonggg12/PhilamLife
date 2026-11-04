// Stable, comparable intent for one financial request. Database triggers may
// recompute balances, receipts, and actor display names, so compare only the
// identifying and financial fields that the request itself can determine.
const str = (value) => String(value ?? '').trim()
const money = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error('Payment or expense amount is invalid.')
  const cents = Math.round(n * 100)
  if (!Number.isSafeInteger(cents)) throw new Error('Amount is too large.')
  return cents
}
const normalize = (kind, value) => {
  if (kind === 'payment') {
    const discount = value.receipt_breakdown?.annual_advance_discount
    return {
      kind,
      submission_key: str(value.submission_key),
      property_id: str(value.property_id),
      recorded_by: str(value.recorded_by),
      charge_type: str(value.charge_type || 'Association Dues'),
      coverage_period: str(value.coverage_period),
      amount: money(value.amount),
      amount_paid: money(value.amount_paid ?? value.amount),
      payment_method: str(value.payment_method),
      reference_number: str(value.reference_number),
      note: str(value.note),
      annual_gross: discount ? money(discount.gross_amount) : null,
      annual_discount: discount ? money(discount.discount_amount) : null,
      annual_months: discount ? Number(discount.months_covered) : null,
    }
  }
  if (kind === 'expense') {
    return {
      kind,
      submission_key: str(value.submission_key),
      recorded_by: str(value.recorded_by),
      expense_date: str(value.expense_date),
      category: str(value.category),
      description: str(value.description),
      amount: money(value.amount),
      reference_number: str(value.reference_number),
      supporting_note: str(value.supporting_note),
      backdate_reason: str(value.backdate_reason),
    }
  }
  throw new Error('Unknown financial transaction type.')
}
export function financialSubmissionIntent(kind, payload) {
  return normalize(kind, payload)
}
export function assertFinancialSubmissionMatches(expected, saved) {
  if (!expected || !saved || !saved.id) {
    throw new Error('Saved transaction could not be verified. Check history before retrying.')
  }
  const actual = normalize(expected.kind, saved)
  if (Object.keys(expected).some((key) => expected[key] !== actual[key])) {
    throw new Error('Saved transaction differs from this submission. Check history; do not record another payment.')
  }
  const status = str(saved.status).toLowerCase()
  if (status === 'voided') {
    throw new Error('The earlier transaction has been voided. Review history before starting a new payment.')
  }
  if (expected.kind === 'payment' && !saved.receipt_number) {
    throw new Error('The saved payment has no verified receipt number.')
  }
  return saved
}
export function requireUnchangedFinancialAttempt(earlier, current) {
  if (!earlier) return
  const fields = Object.keys(earlier)
  if (fields.some((field) => earlier[field] !== current[field])) {
    throw new Error('These details changed after a submission attempt. Check transaction history, then close and reopen the form for a new payment.')
  }
}