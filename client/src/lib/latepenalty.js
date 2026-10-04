/**
 * Shared logic for enforcing the "Due Day", "Grace Period", and
 * "Late-Payment Penalty" values configured in System Settings.
 *
 * Previously these three settings were saved to the database but never
 * read anywhere else in the app. This module computes, for a given
 * outstanding balance, whether that balance is currently past its grace
 * period and (if so) what the effective total due is including the
 * configured late penalty.
 *
 * This is a display-time calculation only — it never writes the penalty
 * back into `payments.remaining_balance`, so it can't silently corrupt
 * financial records. The Treasurer/Secretary still record the actual
 * penalty as a real line item (e.g. via Expenses or an adjusted payment)
 * if they choose to collect it.
 */

function manilaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const part = (type) => Number(parts.find((item) => item.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day') }
}

/**
 * Returns the most recent billing due-date (with grace period applied)
 * that is on or before today, for a recurring monthly due day.
 */
function currentDeadline(dueDay, gracePeriodDays) {
  const { year, month, day } = manilaToday()
  const safeDueDay = Math.min(Math.max(Number(dueDay) || 1, 1), 28)

  // This month's due date, then push it out by the grace period.
  let deadline = new Date(Date.UTC(year, month - 1, safeDueDay))
  deadline.setUTCDate(deadline.getUTCDate() + (Number(gracePeriodDays) || 0))

  const today = new Date(Date.UTC(year, month - 1, day))

  // If this month's deadline hasn't arrived yet, the relevant deadline
  // the homeowner could still be behind on is last month's cycle.
  if (deadline > today) {
    deadline = new Date(Date.UTC(year, month - 2, safeDueDay))
    deadline.setUTCDate(deadline.getUTCDate() + (Number(gracePeriodDays) || 0))
  }

  return { deadline, today }
}

/**
 * @param {object} params
 * @param {number} params.balance - outstanding balance for the property
 * @param {number} params.dueDay - day of month dues are due (1-28)
 * @param {number} params.gracePeriodDays - grace period after due day
 * @param {number} params.latePenalty - flat penalty amount if overdue
 * @returns {{ isOverdue: boolean, penaltyAmount: number, totalDue: number, daysOverdue: number }}
 */
export function computeLateFee({ balance, dueDay, gracePeriodDays, latePenalty }) {
  const owedAmount = Number(balance) || 0

  if (owedAmount <= 0) {
    return { isOverdue: false, penaltyAmount: 0, totalDue: owedAmount, daysOverdue: 0 }
  }

  const { deadline, today } = currentDeadline(dueDay, gracePeriodDays)
  const isOverdue = today > deadline
  const penaltyAmount = isOverdue ? Number(latePenalty) || 0 : 0
  const daysOverdue = isOverdue
    ? Math.round((today.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24))
    : 0

  return {
    isOverdue,
    penaltyAmount,
    totalDue: owedAmount + penaltyAmount,
    daysOverdue,
  }
}

/**
 * Per-charge overdue calculation. Payments are applied to the oldest charges
 * first, so the unpaid part of the balance sits on the newest charges.
 * A charge is overdue once its due date + grace period has passed:
 *  - monthly dues: billing month's Due Day + grace period
 *  - manual charges: date added + grace period
 * Any part of the balance not backed by a charge (opening balances recorded
 * before charges existed) is judged with the old computeLateFee() rule.
 * A balance of zero or below (advance credit) is never overdue.
 */
export function computeOverdueFromCharges({ balance, charges = [], dueDay, gracePeriodDays, latePenalty }) {
  const owed = Number(balance) || 0
  const none = { isOverdue: false, penaltyAmount: 0, totalDue: owed, daysOverdue: 0, overdueAmount: 0 }
  if (owed <= 0) return none

  const grace = Number(gracePeriodDays) || 0
  const safeDueDay = Math.min(Math.max(Number(dueDay) || 1, 1), 31)
  const { year, month, day } = manilaToday()
  const today = new Date(Date.UTC(year, month - 1, day))
  const DAY = 24 * 60 * 60 * 1000

  const dated = charges
    .map((charge) => {
      let base
      if (charge.billing_month) {
        const [y, m] = String(charge.billing_month).slice(0, 10).split('-').map(Number)
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
        base = new Date(Date.UTC(y, m - 1, Math.min(safeDueDay, lastDay)))
      } else {
        const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(charge.created_at))
        const [y, m, d] = iso.split('-').map(Number)
        base = new Date(Date.UTC(y, m - 1, d))
      }
      return { amount: Number(charge.amount) || 0, deadline: new Date(base.getTime() + grace * DAY) }
    })
    .sort((a, b) => a.deadline - b.deadline)

  const chargesTotal = dated.reduce((sum, item) => sum + item.amount, 0)
  let unpaid = Math.min(owed, chargesTotal)
  const legacy = Math.round((owed - unpaid) * 100) / 100

  let overdueAmount = 0
  let daysOverdue = 0
  let oldestOverdueDeadline = null

  for (let i = dated.length - 1; i >= 0 && unpaid > 0.005; i -= 1) {
    const take = Math.min(unpaid, dated[i].amount)
    unpaid -= take
    if (dated[i].deadline < today) {
      overdueAmount += take
      daysOverdue = Math.max(daysOverdue, Math.round((today - dated[i].deadline) / DAY))
      if (!oldestOverdueDeadline || dated[i].deadline < oldestOverdueDeadline) {
        oldestOverdueDeadline = dated[i].deadline
      }
    }
  }

  if (legacy > 0.005) {
    const old = computeLateFee({ balance: legacy, dueDay, gracePeriodDays, latePenalty })
    if (old.isOverdue) {
      overdueAmount += legacy
      daysOverdue = Math.max(daysOverdue, old.daysOverdue)
    }
  }

  const isOverdue = overdueAmount > 0.005
  // If staff already added a real "Penalty / Late Fee" charge since this account
  // went overdue, it is part of the balance - don't also show the display-only fee.
  const penaltyAlreadyCharged = oldestOverdueDeadline
    ? charges.some(
        (charge) =>
          charge.charge_type === 'Penalty / Late Fee' &&
          new Date(charge.created_at) >= oldestOverdueDeadline,
      )
    : false
  const penaltyAmount = isOverdue && !penaltyAlreadyCharged ? Number(latePenalty) || 0 : 0
  return {
    isOverdue,
    penaltyAmount,
    totalDue: owed + penaltyAmount,
    daysOverdue: isOverdue ? daysOverdue : 0,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
  }
}
/**
 * One account's balance + overdue status from the stored balance and charges.
 * `settings` is the System Settings row (due_day, grace_period_days, late_penalty).
 * balance = amount owed (never negative); credit = advance credit.
 */
export function accountStatus(property, charges, settings) {
  const stored = Number(property.current_balance) || 0
  const result = computeOverdueFromCharges({
    balance: stored,
    // `charges` may be a Map(propertyId -> charges[]) built once by the caller
    // (fast for hundreds of homeowners) or a plain array (filtered here).
    charges: charges instanceof Map
      ? (charges.get(Number(property.id)) || [])
      : (charges || []).filter((charge) => Number(charge.property_id) === Number(property.id)),
    dueDay: Number(settings?.due_day) || 5,
    gracePeriodDays: Number(settings?.grace_period_days) || 0,
    latePenalty: Number(settings?.late_penalty) || 0,
  })
  return {
    stored,
    balance: Math.max(stored, 0),
    credit: Math.max(-stored, 0),
    isOverdue: result.isOverdue,
    daysOverdue: result.daysOverdue,
    overdueAmount: result.overdueAmount,
  }
}
/** Group charges by property once, for use with accountStatus(). */
export function groupChargesByProperty(charges) {
  const grouped = new Map()
  for (const charge of charges || []) {
    const key = Number(charge.property_id)
    const list = grouped.get(key)
    if (list) list.push(charge)
    else grouped.set(key, [charge])
  }
  return grouped
}