const DECIMAL_RE = /^\d+(\.\d{1,2})?$/

const pesoFormat = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

// Returns { value } (a clean decimal string) or { error }. No float math on money.
export function parsePositiveAmount(raw, label, { maxInt = 8 } = {}) {
  const text = String(raw ?? '').trim()
  if (!text) return { error: `${label} is required.` }
  if (text.startsWith('-')) return { error: `${label} cannot be negative.` }
  if (!DECIMAL_RE.test(text)) {
    return { error: `${label} must be a number with at most 2 decimal places.` }
  }
  const whole = text.split('.')[0].replace(/^0+(?=\d)/, '')
  if (whole.length > maxInt) return { error: `${label} is too large.` }
  if (Number(text) <= 0) return { error: `${label} must be greater than 0.` }
  return { value: text }
}

export function formatLotSize(value) {
  const n = Number(value)
  if (value == null || value === '' || !Number.isFinite(n) || n <= 0) return 'Lot size not set'
  return `${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} sqm`
}

export function formatRate(value) {
  const n = Number(value)
  if (value == null || value === '' || !Number.isFinite(n) || n <= 0) return 'Rate not set'
  return `${pesoFormat.format(n)} / sqm`
}

// Display only. The amount itself is always computed in the database.
export function formatDues(value) {
  const n = Number(value)
  return pesoFormat.format(Number.isFinite(n) ? n : 0)
}