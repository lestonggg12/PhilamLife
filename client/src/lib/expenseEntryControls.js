import { isValidExpenseDate } from './expenseSummary'

// A date-only ISO string compares chronologically without a timezone shift.
// The server separately derives today's date using Asia/Manila.
export function expenseDateControlError(date, today, backdateReason) {
  if (!isValidExpenseDate(date) || !isValidExpenseDate(today)) return 'Select a valid expense date.'
  if (date > today) return 'Future expense dates are not allowed.'
  const reason = String(backdateReason ?? '').trim()
  if (date < today && (reason.length < 10 || reason.length > 500)) {
    return 'Explain why you are recording an expense for a past date (10 to 500 characters).'
  }
  if (date === today && reason) return 'A past-date explanation is only needed for an earlier expense date.'
  return ''
}

export function expenseEvidenceControlError(reference, explanation) {
  const ref = String(reference ?? '').trim()
  const note = String(explanation ?? '').trim()
  if (!ref && (note.length < 10 || note.length > 500)) {
    return 'Enter a receipt/invoice reference, or explain missing supporting documentation (10 to 500 characters).'
  }
  if (note.length > 500) return 'Supporting-document explanation is too long (maximum 500 characters).'
  return ''
}