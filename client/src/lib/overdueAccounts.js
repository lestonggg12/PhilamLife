// The read-only overdue view is authoritative for aging. A payment's latest
// amount is not proof that the entire account has been settled.
const AGING_TIERS = ['1-30 days', '31-60 days', '61-90 days', '90+ days']
const amount = (value) => Math.max(0, Number(value) || 0)

export function describeOverdueAccount(property, aging, lastPayment) {
  const balance = amount(aging?.balance ?? property.current_balance)
  const overdueAmount = Math.min(balance, amount(aging?.overdue_amount))
  const daysOverdue = Math.max(0, Number(aging?.days_overdue) || 0)
  const needsReview = !aging || aging.aging_complete === false
  const hasPayment = lastPayment?.latest_paid_at != null

  // A missing or unreconciled summary must not be reported as paid/current.
  const status = needsReview ? 'Review'
    : balance <= 0.005 ? 'Paid'
      : overdueAmount > 0.005 ? 'Overdue'
        : hasPayment ? 'Partial' : 'Pending'

  const agingTier = status !== 'Overdue' ? null
    : daysOverdue <= 30 ? '1-30 days'
      : daysOverdue <= 60 ? '31-60 days'
        : daysOverdue <= 90 ? '61-90 days' : '90+ days'

  return { balance, overdueAmount, daysOverdue, status, agingTier, needsReview }
}

export function summarizeOverdueAccounts(accounts) {
  const overdue = accounts.filter((a) => a.status === 'Overdue')
  const byTier = Object.fromEntries(AGING_TIERS.map((tier) => [tier, {
    count: 0,
    balance: 0,
  }]))
  let overdueBalance = 0
  let currentPortion = 0
  for (const account of overdue) {
    const pastDue = amount(account.overdueAmount)
    overdueBalance += pastDue
    currentPortion += Math.max(0, amount(account.balance) - pastDue)
    if (byTier[account.agingTier]) {
      byTier[account.agingTier].count += 1
      byTier[account.agingTier].balance += pastDue
    }
  }
  return {
    overdueCount: overdue.length,
    overdueBalance,
    currentPortion,
    totalAccounts: accounts.length,
    reviewCount: accounts.filter((a) => a.needsReview).length,
    byTier,
  }
}

// Validate a complete read before it can replace the financial dashboard snapshot.
export function verifyOverdueSnapshot(properties, payments, settings, agingRows) {
  if (![properties, payments, agingRows].every(Array.isArray) || !settings) {
    throw new Error('Incomplete overdue data was returned. Refresh before relying on the totals.')
  }
  if (![settings.due_day, settings.grace_period_days].every((value) =>
    Number.isInteger(Number(value)) && Number(value) >= 0)) {
    throw new Error('Billing settings could not be verified.')
  }
  const seen = new Set()
  for (const row of agingRows) {
    const id = Number(row.property_id)
    if (!Number.isSafeInteger(id) || seen.has(id) ||
        ![row.balance, row.overdue_amount].every((value) => value !== null && value !== '' && Number.isFinite(Number(value))) ||
        row.aging_complete == null) {
      throw new Error('An overdue summary is missing or contains invalid financial data.')
    }
    seen.add(id)
  }
  if (seen.size !== properties.length || properties.some((property) =>
    !seen.has(Number(property.id)) || property.current_balance == null ||
    !Number.isFinite(Number(property.current_balance)))) {
    throw new Error('Overdue summaries do not match the homeowner accounts. Refresh before relying on the totals.')
  }
}
