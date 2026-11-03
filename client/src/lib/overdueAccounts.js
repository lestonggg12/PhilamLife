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
