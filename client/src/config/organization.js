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