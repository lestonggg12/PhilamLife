// Build only the settings editable in the General and Security tabs. Never
// resend pricing, penalty policy or hidden notification fields from a stale read.
const DATE_FORMATS = new Set(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'])

function wholeNumber(value, label, min, max) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  const number = Number(text)
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`)
  }
  return number
}

export function buildSystemSettingsPayload(settings) {
  const hoaName = String(settings.hoa_name ?? '').trim()
  const address = String(settings.address ?? '').trim()
  const email = String(settings.contact_email ?? '').trim()
  const phone = String(settings.contact_phone ?? '').trim()
  if (!hoaName) throw new Error('HOA name is required.')
  if (!address) throw new Error('Address is required.')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid contact email.')
  const billingDay = wholeNumber(settings.billing_day, 'Billing day', 1, 31)
  const dueDay = wholeNumber(settings.due_day, 'Due day', 1, 31)
  if (dueDay < billingDay) throw new Error('Due day must be on or after the billing day.')
  const grace = wholeNumber(settings.grace_period_days, 'Grace period', 0, 2147483647)
  const timeout = wholeNumber(settings.session_timeout, 'Session timeout', 5, 1440)
  if (settings.currency !== 'PHP') throw new Error('Currency must be PHP.')
  if (settings.timezone !== 'Asia/Manila') throw new Error('Time zone must be Asia/Manila.')
  if (!DATE_FORMATS.has(settings.date_format)) throw new Error('Select a valid date format.')
  if (typeof settings.require_strong_password !== 'boolean') throw new Error('Invalid password preference.')
  return {
    hoa_name: hoaName,
    address,
    contact_email: email || null,
    contact_phone: phone || null,
    billing_day: billingDay,
    due_day: dueDay,
    grace_period_days: grace,
    require_strong_password: settings.require_strong_password,
    session_timeout: timeout,
    currency: settings.currency,
    timezone: settings.timezone,
    date_format: settings.date_format,
  }
}
