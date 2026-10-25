// Helpers for the yearly late-payment penalty (admin settings, balance
// entries and the receipt breakdown). Peso amounts are never computed here:
// the database does all of the arithmetic and rounding.

const PERCENT_RE = /^\d{1,3}(\.\d{1,2})?$/

const cents = (value) => Math.round((Number(value) || 0) * 100)

// "1.5" -> "0.0150" (the fraction the database stores). Returns { value } or { error }.
export function percentToFraction(raw, label = 'Penalty rate') {
  const text = String(raw ?? '').trim()
  if (!text) return { error: `${label} is required.` }
  if (text.startsWith('-')) return { error: `${label} cannot be negative.` }
  if (!PERCENT_RE.test(text)) {
    return { error: `${label} must be a number with at most 2 decimal places.` }
  }
  if (Number(text) > 100) return { error: `${label} cannot be more than 100%.` }
  return { value: (Number(text) / 100).toFixed(4) }
}

// 0.0150 -> "1.5"
export function fractionToPercent(fraction) {
  const n = Number(fraction)
  if (fraction == null || fraction === '' || !Number.isFinite(n)) return ''
  return String(Number((n * 100).toFixed(2)))
}

export function formatPercent(fraction) {
  const text = fractionToPercent(fraction)
  return text === '' ? '' : `${text}%`
}

// A whole number between min and max. Returns { value } or { error }.
export function parseWholeNumber(raw, label, min, max) {
  const text = String(raw ?? '').trim()
  if (!text) return { error: `${label} is required.` }
  if (!/^\d+$/.test(text)) return { error: `${label} must be a whole number.` }
  const n = Number(text)
  if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}.` }
  return { value: n }
}

// "Late penalties (6 × 1.5%)" when every penalty used one rate and none has
// been paid yet; otherwise "Late penalties (6)". Returns '' with no penalties.
export function penaltyLabel(breakdown) {
  const count = Number(breakdown?.penalties_count) || 0
  if (count <= 0) return ''
  const rated = Number(breakdown?.penalties_rated_count) || 0
  const min = breakdown?.rate_min
  const max = breakdown?.rate_max
  const sameRate = min != null && max != null && Number(min) === Number(max)
  const untouched = cents(breakdown?.penalties_outstanding) === cents(breakdown?.penalties_posted_total)
  if (count === rated && sameRate && untouched) {
    return `Late penalties (${count} × ${formatPercent(min)})`
  }
  return `Late penalties (${count})`
}

export function hasBreakdown(breakdown) {
  if (!breakdown) return false
  return cents(breakdown.entered_balance) > 0 || (Number(breakdown.penalties_count) || 0) > 0
}