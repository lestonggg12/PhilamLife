import { describe, expect, it } from 'vitest'
import { describeOverdueAccount, matchesAgingTier, movedAccountsWithBalance, summarizeOverdueAccounts } from './overdueAccounts'

const buckets = {
  days_1_30_amount: 0, days_31_60_amount: 0, days_61_90_amount: 0, days_90_plus_amount: 0,
}

function account(balance, changes = {}) {
  return describeOverdueAccount({ current_balance: balance }, {
    ...buckets, balance: Math.max(balance, 0), overdue_amount: 0, current_amount: Math.max(balance, 0),
    days_overdue: 0, aging_complete: true, ...changes,
  })
}

describe('overdue accounting', () => {
  it('allocates the actual centavos to each age range and counts the lot once overall', () => {
    const mixed = account(1500, {
      overdue_amount: 1000, current_amount: 500, days_overdue: 159,
      days_1_30_amount: 480.01, days_90_plus_amount: 519.99,
    })
    expect(mixed).toMatchObject({ status: 'Overdue', balance: 1500, overdueAmount: 1000, daysOverdue: 159 })
    const totals = summarizeOverdueAccounts([mixed])
    expect(totals).toMatchObject({ overdueBalance: 1000, currentPortion: 500, overdueCount: 1 })
    expect(totals.byTier['1-30 days']).toEqual({ count: 1, balance: 480.01 })
    expect(totals.byTier['91+ days']).toEqual({ count: 1, balance: 519.99 })
    expect(matchesAgingTier(mixed, '1-30 days')).toBe(true)
    expect(matchesAgingTier(mixed, '31-60 days')).toBe(false)
    expect(summarizeOverdueAccounts([mixed], '91+ days').overdueBalance).toBe(519.99)
  })

  it('uses the reported current balance and adds no hypothetical penalties', () => {
    const row = account(1500, {
      overdue_amount: 1000, days_1_30_amount: 1000, current_amount: 500, days_overdue: 5,
      total_due: 1900, penalty_amount: 400,
    })
    expect(row).toMatchObject({ balance: 1500, overdueAmount: 1000 })
    expect(summarizeOverdueAccounts([row, account(75)]).currentPortion).toBe(575)
  })

  it.each([
    { aging_complete: false },
    { overdue_amount: 1 },
    { days_overdue: 1 },
    { current_amount: null },
    { days_1_30_amount: -1 },
    { balance: 1501 },
  ])('excludes unverifiable aging from the totals: %o', (invalid) => {
    const row = account(1500, invalid)
    expect(row).toMatchObject({ status: 'Review', overdueAmount: null, needsReview: true })
    expect(summarizeOverdueAccounts([row])).toMatchObject({ reviewCount: 1, overdueBalance: 0, currentPortion: 0 })
    expect(matchesAgingTier(row, '91+ days')).toBe(false)
  })

  it('describes what is owed without inferring payment status from old receipts', () => {
    expect(describeOverdueAccount({ current_balance: 10 }, null).status).toBe('Review')
    expect(account(75).status).toBe('Current')
    expect(account(0).status).toBe('No balance due')
    expect(account(-100).status).toBe('No balance due')
  })
})

it('surfaces only moved accounts with positive balances for separate follow-up', () => {
  expect(movedAccountsWithBalance([
    { id: 1, homeowner_status: 'moved', current_balance: '400.00' },
    { id: 2, homeowner_status: 'moved', current_balance: '-10.00' },
    { id: 3, homeowner_status: 'active', current_balance: '10.00' },
    { id: 4, homeowner_status: 'transferred', current_balance: '20.00' },
  ]).map(row => row.id)).toEqual([1])
})
