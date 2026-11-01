export const PAYMENT_PURPOSES = [
  'Association Dues',
  'Balance Payment',
  'Special Assessment',
  'Penalty / Late Fee',
  'Sticker / ID Fee',
  'Document / Certification Fee',
  'Other',
]

// A payment against an existing balance must never create a new charge.
export const CHARGE_TYPES = PAYMENT_PURPOSES.filter(
  (purpose) => !['Association Dues', 'Balance Payment'].includes(purpose),
)

export function isBalanceReducingPurpose(purpose) {
  return !purpose || ['Association Dues', 'Balance Payment'].includes(String(purpose).trim())
}

// Shared confirmation rule; only the part above the account debt is credit.
export function paymentAdvanceConfirmation({ purpose, paid, previous, openOfType = 0, annualAdvance = false }) {
  const cents = (value) => Math.round((Number(value) || 0) * 100)
  const paidCents = cents(paid)
  if (paidCents <= 0 || annualAdvance) return null
  if (isBalanceReducingPurpose(purpose)) {
    return paidCents > Math.max(cents(previous), 0)
      ? { credit: (paidCents - cents(previous)) / 100, paid: paidCents / 100 }
      : null
  }
  if (purpose && purpose !== 'Other' && paidCents > cents(openOfType)) {
    return { credit: (paidCents - cents(openOfType)) / 100, paid: paidCents / 100, kind: 'fee', feeType: purpose }
  }
  return null
}
