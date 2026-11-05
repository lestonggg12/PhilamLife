export const CLASSIFICATIONS = Object.freeze([
  { value: 'unclassified', label: 'Unclassified' },
  { value: 'lot_owner', label: 'Lot Owner (vacant lot)' },
  { value: 'homeowner', label: 'Homeowner (lot with house)' },
])

export function classificationLabel(value) {
  return CLASSIFICATIONS.find((entry) => entry.value === value)?.label ?? 'Unknown'
}

export function canClassifyProperty(role) {
  return role === 'admin' || role === 'secretary'
}

export function manilaToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const item = (name) => parts.find((part) => part.type === name)?.value
  return `${item('year')}-${item('month')}-${item('day')}`
}

export function validateClassificationChange({ current, next, reason, effectiveFrom, today = manilaToday() }) {
  if (!CLASSIFICATIONS.some((entry) => entry.value === next)) return 'Choose a valid classification.'
  if (current === next) return 'Choose a different classification.'
  if (String(reason ?? '').trim().length < 5 || String(reason ?? '').trim().length > 1000) {
    return 'Enter a reason between 5 and 1000 characters.'
  }
  if (effectiveFrom !== today) return 'Phase 1 permits today (Manila) only.'
  return ''
}
