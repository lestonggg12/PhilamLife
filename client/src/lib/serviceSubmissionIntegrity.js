// A submission key identifies ONE immutable payment attempt, not a reusable form.
// Historical receipts have no submission key and remain unchanged.
const primaryFields = [
  'submission_key', 'property_id', 'service_id', 'service_date',
  'start_time', 'end_time', 'quantity', 'unit_rate',
  'rate_unit_snapshot', 'amount_due', 'amount_paid',
  'payment_method', 'reference_number', 'notes', 'recorded_by',
]
const collectionFields = [
  'submission_key', 'balance_of', 'property_id', 'service_id',
  'amount_paid', 'payment_method', 'reference_number',
  'recorded_by', 'notes',
]
// The database prefixes settlement notes with the original receipt number.
const collectionReceiptFields = collectionFields.filter((field) => field !== 'notes')
const centsFields = new Set(['unit_rate', 'amount_due', 'amount_paid'])
const numericFields = new Set(['property_id', 'quantity'])
const timeFields = new Set(['start_time', 'end_time'])

function normalized(field, value) {
  if (value == null || value === '') return null
  if (centsFields.has(field)) return Math.round(Number(value) * 100)
  if (field === 'quantity') return Math.round(Number(value) * 10000)
  if (numericFields.has(field)) return Number(value)
  if (timeFields.has(field)) return String(value).slice(0, 5)
  if (field === 'service_date') return String(value).slice(0, 10)
  if (field === 'notes' || field === 'reference_number') return String(value).trim() || null
  return String(value)
}

export function serviceSubmissionSnapshot(kind, payload) {
  const fields = kind === 'payment' ? primaryFields
    : kind === 'collection' ? collectionFields : null
  if (!fields) throw new Error('Unknown service submission type.')
  if (!payload?.submission_key) throw new Error('Submission key is required.')
  return Object.freeze({
    kind,
    ...Object.fromEntries(fields.map((field) => [field, normalized(field, payload[field])])),
  })
}

export function sameServiceSubmission(first, second) {
  return Boolean(first && second && JSON.stringify(first) === JSON.stringify(second))
}

export function assertServiceReceiptMatches(snapshot, receipt) {
  if (!snapshot || !receipt?.id || !receipt?.receipt_number || receipt.payment_status === 'voided') {
    throw new Error('Saved receipt could not be verified. Check receipt history before making another payment.')
  }
  const fields = snapshot.kind === 'payment' ? primaryFields : collectionReceiptFields
  for (const field of fields) {
    if (snapshot[field] !== normalized(field, receipt[field])) {
      throw new Error('Saved receipt differs from the submitted payment. Check receipt history; do not create another payment.')
    }
  }
  if (snapshot.kind === 'collection' && snapshot.notes) {
    // Settlement trigger prefixes notes; the original note must still be present.
    if (!String(receipt.notes || '').includes(snapshot.notes)) {
      throw new Error('Saved settlement notes differ from the submitted payment. Check receipt history.')
    }
  }
  return receipt
}