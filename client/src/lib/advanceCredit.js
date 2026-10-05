const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

// Advance-credit details from the admin's System Settings (monthly dues
// amount, due day, grace period). Credit is deducted when the next month's
// dues are billed (1st of the month).
export function advanceCreditDetails(rawCredit, settings) {
  // Round to whole centavos first: JavaScript decimals like 4999.98 - 3499.98
  // come out as 1499.9999999999995, which would undercount whole months.
  const credit = Math.round((Number(rawCredit) || 0) * 100) / 100
  if (!settings) return { credit, hasSettings: false }

  const dues = Number(settings.dues_amount) || 0
  const dueDay = Math.min(Math.max(Number(settings.due_day) || 1, 1), 31)
  const billingDay = Math.min(Math.max(Number(settings.billing_day) || 1, 1), 31)
  const grace = Number(settings.grace_period_days) || 0

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type) => Number(parts.find((item) => item.type === type).value)
  const year = part('year')
  const month0 = part('month') - 1
  const today = part('day')

  // Date on `day` of the month (clamped to the month's last day); month0 may overflow into next year.
  const onDay = (y, m0, day) => {
    const lastDay = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate()
    return new Date(Date.UTC(y, m0, Math.min(day, lastDay)))
  }
  const fmt = (date) =>
    date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })

  // Next billing run: the admin's billing day. If this month is already billed, it is next month's.
  // If this month isn't billed yet and the day has passed, the daily run will bill it tomorrow.
  let billing = onDay(year, month0, billingDay)
  if (settings.billed_this_month) {
    billing = onDay(year, month0 + 1, billingDay)
  } else {
    const tomorrow = new Date(Date.UTC(year, month0, today + 1))
    if (billing < tomorrow) billing = tomorrow
  }

  const due = onDay(billing.getUTCFullYear(), billing.getUTCMonth(), dueDay)
  const months = dues > 0 ? Math.floor(credit / dues) : 0
  const rest = dues > 0 ? Math.round((credit - months * dues) * 100) / 100 : 0

  return {
    credit,
    hasSettings: true,
    dues,
    grace,
    months,
    rest,
    shortfall: dues > 0 && months === 0 ? Math.round((dues - credit) * 100) / 100 : 0,
    billing: fmt(billing),
    due: fmt(due),
    deadline: fmt(new Date(due.getTime() + grace * 86400000)),
  }
}

export function advanceCreditNote(credit, settings) {
  const d = advanceCreditDetails(credit, settings)
  const amount = peso.format(credit)
  if (!d.hasSettings) {
    return `${amount} will be kept as advance credit and deducted when the next monthly dues are billed.`
  }

  const schedule = d.grace > 0
    ? `due ${d.due}, grace period until ${d.deadline}`
    : `due ${d.due}, no grace period`

  let coverage = ''
  if (d.dues > 0) {
    coverage = d.months > 0
      ? ` This covers ${d.months} full month${d.months > 1 ? 's' : ''} of dues${d.rest > 0 ? `, plus ${peso.format(d.rest)} toward the next` : ''}.`
      : ` This is less than one month's dues, so ${peso.format(d.shortfall)} will still be due after the deduction.`
  }

  return `${amount} will be kept as advance credit and deducted automatically when the next monthly dues (${peso.format(d.dues)}) are billed on ${d.billing} (${schedule}).${coverage}`
}