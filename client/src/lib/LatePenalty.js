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