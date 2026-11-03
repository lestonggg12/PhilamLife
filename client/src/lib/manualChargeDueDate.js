// Date-only comparisons are intentional: all deadlines are Manila calendar dates.
// The date is inclusive; an unpaid charge becomes overdue on the following day.
export function isValidManualChargeDueDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today ?? ''))) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= today
}

export function accountLedgerStatus({ balance, agingComplete, isOverdue, hasPartialPayment }) {
  if (agingComplete !== true) return 'Review'
  if (balance <= 0) return 'Paid'
  if (isOverdue === true) return 'Overdue'
  return hasPartialPayment === true ? 'Partially Paid' : 'Pending'
}
