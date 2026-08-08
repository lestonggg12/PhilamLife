// Central branding/config defaults for PHILAM Village.
// OrganizationContext.jsx reads real values from the `system_settings` table
// (id = 1) and falls back to these constants when the DB hasn't loaded yet,
// a row is missing, or a field is blank.

export const DEFAULT_ORGANIZATION = {
  hoaName: 'PHILAM Village',
  address: 'Cagayan de Oro City, Philippines',
  currency: 'PHP',
  locale: 'en-PH',
  timezone: 'Asia/Manila',
  sessionTimeoutMinutes: 30,
  dateFormat: 'MM/DD/YYYY',
  requireStrongPassword: true,
}

const CURRENCY_SYMBOLS = {
  PHP: '₱',
  USD: '$',
}

/**
 * Turns a raw HOA name into the full display/association name used in
 * headers, footers, and printed documents (e.g. receipts).
 *   "PHILAM Village" -> "PHILAM Village Homeowners Association"
 */
export function getAssociationName(hoaName) {
  const name = String(hoaName || DEFAULT_ORGANIZATION.hoaName).trim()

  if (/homeowners association|\bhoa\b/i.test(name)) {
    return name
  }

  return `${name} Homeowners Association`
}

export function getCurrencySymbol(currency) {
  const code = String(currency || DEFAULT_ORGANIZATION.currency).trim().toUpperCase()
  return CURRENCY_SYMBOLS[code] || code
}

/**
 * Formats a numeric amount using the organization's active currency.
 * Falls back to the default currency (PHP) if none is supplied.
 */
export function formatCurrency(value, currency) {
  const code = String(currency || DEFAULT_ORGANIZATION.currency).trim().toUpperCase()
  const amount = Number(value) || 0

  try {
    return new Intl.NumberFormat(DEFAULT_ORGANIZATION.locale, {
      style: 'currency',
      currency: code,
    }).format(amount)
  } catch {
    // Unknown/unsupported currency code — fall back to symbol + fixed decimals.
    return `${getCurrencySymbol(code)}${amount.toFixed(2)}`
  }
}

/**
 * Formats a date/time value according to the org's date_format setting
 * (from System Settings -> General -> Date Format). This is the single
 * place that setting actually takes effect — every page should call this
 * (via useOrganization().formatDate) instead of building its own
 * Intl.DateTimeFormat, or the setting has no real effect.
 *
 * @param {Date|string|number} value - date to format
 * @param {object} [options]
 * @param {string} [options.dateFormat] - 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
 * @param {string} [options.timezone] - IANA timezone, defaults to org timezone
 * @param {boolean} [options.withTime] - append localized time (h:mm AM/PM)
 */
export function formatDate(value, { dateFormat, timezone, withTime = false } = {}) {
  if (!value) return '—'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const tz = timezone || DEFAULT_ORGANIZATION.timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  const { year, month, day } = lookup

  const format = dateFormat || DEFAULT_ORGANIZATION.dateFormat
  let datePart
  if (format === 'DD/MM/YYYY') datePart = `${day}/${month}/${year}`
  else if (format === 'YYYY-MM-DD') datePart = `${year}-${month}-${day}`
  else datePart = `${month}/${day}/${year}` // MM/DD/YYYY default

  if (!withTime) return datePart

  const timePart = new Intl.DateTimeFormat('en-PH', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)

  return `${datePart}, ${timePart}`
}