// Amounts and their aging come from the read-only database view.
const AGING_COLUMNS = {
  '1-30 days': 'days_1_30_amount',
  '31-60 days': 'days_31_60_amount',
  '61-90 days': 'days_61_90_amount',
  '91+ days': 'days_90_plus_amount',
}
export const AGING_TIERS = Object.keys(AGING_COLUMNS)
export const OVERDUE_COLUMNS = [
  'property_id', 'balance', 'overdue_amount', 'current_amount', 'days_overdue',
  'aging_complete', ...Object.values(AGING_COLUMNS),
].join(', ')

function cents(value) {
  if (value == null || String(value).trim() === '') return NaN
  const result = Math.round(Number(value) * 100)
  return Number.isSafeInteger(result) ? result : NaN
}

export function describeOverdueAccount(property, aging) {
  const balance = Math.max(cents(property.current_balance), 0) / 100
  const amounts = Object.fromEntries(AGING_TIERS.map(tier => [tier, cents(aging?.[AGING_COLUMNS[tier]])]))
  const pastDue = cents(aging?.overdue_amount)
  const current = cents(aging?.current_amount)
  const daysOverdue = Number(aging?.days_overdue)
  const needsReview = aging?.aging_complete !== true || cents(aging.balance) !== cents(balance)
    || ![pastDue, current, ...Object.values(amounts)].every(value => Number.isSafeInteger(value) && value >= 0)
    || aging?.days_overdue == null || !Number.isSafeInteger(daysOverdue) || daysOverdue < 0 || (daysOverdue > 0) !== (pastDue > 0)
    || pastDue !== Object.values(amounts).reduce((sum, value) => sum + value, 0)
    || pastDue + current !== cents(balance)

  const status = needsReview ? 'Review' : pastDue > 0 ? 'Overdue' : balance > 0 ? 'Current' : 'No balance due'
  return {
    balance,
    overdueAmount: needsReview ? null : pastDue / 100,
    currentAmount: needsReview ? null : current / 100,
    daysOverdue: needsReview ? 0 : daysOverdue,
    status,
    needsReview,
    agingAmounts: needsReview ? {} : Object.fromEntries(AGING_TIERS.map(tier => [tier, amounts[tier] / 100])),
  }
}

export function matchesAgingTier(account, tier) {
  return tier === 'All' || account.agingAmounts[tier] > 0
}

export function summarizeOverdueAccounts(accounts, tier = 'All') {
  const byTier = Object.fromEntries(AGING_TIERS.map(label => [label, { count: 0, balance: 0 }]))
  let overdueCount = 0
  let overdueBalance = 0
  let currentPortion = 0
  let reviewCount = 0
  for (const account of accounts) {
    if (account.needsReview) {
      reviewCount += 1
      continue
    }
    if (!matchesAgingTier(account, tier)) continue
    currentPortion += cents(account.currentAmount)
    overdueBalance += cents(tier === 'All' ? account.overdueAmount : account.agingAmounts[tier])
    if (account.overdueAmount > 0) overdueCount += 1
    for (const label of AGING_TIERS) {
      const amount = cents(account.agingAmounts[label])
      if (amount > 0) {
        byTier[label].count += 1
        byTier[label].balance += amount
      }
    }
  }
  for (const bucket of Object.values(byTier)) bucket.balance /= 100
  return {
    overdueCount, overdueBalance: overdueBalance / 100, currentPortion: currentPortion / 100,
    totalAccounts: accounts.length, reviewCount, byTier,
  }
}

// Confirm the same lots and signed balances were seen by both reads. A row
// with incomplete aging is retained for review and omitted from aging totals.
export function verifyOverdueSnapshot(properties, payments, settings, agingRows) {
  if (![properties, payments, agingRows].every(Array.isArray) || !settings) {
    throw new Error('Incomplete overdue data was returned. Refresh before relying on the totals.')
  }
  if (settings.due_day == null || settings.grace_period_days == null ||
      !Number.isInteger(Number(settings.due_day)) || Number(settings.due_day) < 1 || Number(settings.due_day) > 31 ||
      !Number.isInteger(Number(settings.grace_period_days)) || Number(settings.grace_period_days) < 0) {
    throw new Error('Billing settings could not be verified.')
  }
  const balances = new Map()
  for (const row of agingRows) {
    const id = Number(row.property_id)
    if (!Number.isSafeInteger(id) || id < 1 || balances.has(id) ||
        !Number.isSafeInteger(cents(row.balance)) || cents(row.balance) < 0 ||
        !Number.isSafeInteger(cents(row.overdue_amount)) || cents(row.overdue_amount) < 0 ||
        typeof row.aging_complete !== 'boolean') {
      throw new Error('An overdue summary is missing or contains invalid financial data.')
    }
    balances.set(id, cents(row.balance))
  }
  if (balances.size !== properties.length || new Set(properties.map(property => Number(property.id))).size !== properties.length ||
      properties.some(property => balances.get(Number(property.id)) !== Math.max(0, cents(property.current_balance)))) {
    throw new Error('Overdue summaries do not match the homeowner accounts. Refresh before relying on the totals.')
  }
}

// Keep moved debts visible without mixing them into active-account totals.
export function movedAccountsWithBalance(properties) {
  return properties.filter(property => property.homeowner_status === 'moved' && cents(property.current_balance) > 0)
}
