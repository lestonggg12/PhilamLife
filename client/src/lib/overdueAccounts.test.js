import { describe, expect, it } from 'vitest'
import { describeOverdueAccount, movedAccountsWithBalance, summarizeOverdueAccounts } from './overdueAccounts'

describe('overdue accounting', () => {
  const property = { current_balance: 1500 }

  it('separates the past-due portion from the total payable balance', () => {
    const account = describeOverdueAccount(property, {
      balance: 1500, overdue_amount: 1000, days_overdue: 45,
      is_overdue: true, aging_complete: true,
    }, null)
    expect(account).toMatchObject({
      status: 'Overdue', balance: 1500, overdueAmount: 1000,
      daysOverdue: 45, agingTier: '31-60 days',
    })
    const totals = summarizeOverdueAccounts([account])
    expect(totals.overdueBalance).toBe(1000)
    expect(totals.currentPortion).toBe(500)
    expect(totals.byTier['31-60 days'].balance).toBe(1000)
  })

  it('does not add hypothetical late penalties to owed balances', () => {
    const account = describeOverdueAccount(property, {
      balance: 1500, overdue_amount: 1000, total_due: 1900,
      penalty_amount: 400, days_overdue: 5, aging_complete: true,
    }, null)
    expect(account.balance).toBe(1500)
    expect(account.overdueAmount).toBe(1000)
  })

  it('fails closed on missing or unreconciled database summaries', () => {
    expect(describeOverdueAccount(property, null, null).status).toBe('Review')
    expect(describeOverdueAccount(property, {
      balance: 1500, overdue_amount: 0, aging_complete: false,
    }, null).status).toBe('Review')
  })

  it('does not count the same balance in multiple aging tiers', () => {
    const accounts = [
      { status: 'Overdue', agingTier: '1-30 days', overdueAmount: 100, balance: 150 },
      { status: 'Overdue', agingTier: '90+ days', overdueAmount: 250, balance: 250 },
      { status: 'Pending', overdueAmount: 0, balance: 75 },
    ]
    const totals = summarizeOverdueAccounts(accounts)
    expect(totals.overdueBalance).toBe(350)
    expect(totals.currentPortion).toBe(50)
    expect(totals.overdueCount).toBe(2)
    expect(totals.totalAccounts).toBe(3)
  })

  it('treats a settled account as paid', () => {
    expect(describeOverdueAccount({ current_balance: 0 }, {
      balance: 0, overdue_amount: 0, aging_complete: true,
    }, null).status).toBe('Paid')
  })
})

it('surfaces only moved accounts with positive balances for separate follow-up', () => {
  expect(movedAccountsWithBalance([
    { id: 1, homeowner_status: 'moved', current_balance: '400.00' },
    { id: 2, homeowner_status: 'moved', current_balance: '-10.00' },
    { id: 3, homeowner_status: 'active', current_balance: '10.00' },
  ]).map(row => row.id)).toEqual([1])
})
