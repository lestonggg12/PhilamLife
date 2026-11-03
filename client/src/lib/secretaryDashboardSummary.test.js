import { describe, expect, it } from 'vitest'
import { secretaryDashboardSummary } from './secretaryDashboardSummary'

const month = { year: '2026', month: '11' }
const rows = [
  { month_start: '2026-10-01', dues_collected: '0.10', dues_only_collected: '0.10', dues_only_receipts: 1 },
  { month_start: '2026-11-01', dues_collected: '200.20', dues_only_collected: '100.10', dues_only_receipts: 2 },
  { month_start: '2027-01-01', dues_collected: '9999.00', dues_only_collected: '9999.00', dues_only_receipts: 1 },
]
describe('Secretary Dashboard summaries', () => {
  it('counts only this calendar year while distinguishing dues-only and all cash receipts', () => {
    expect(secretaryDashboardSummary([{ current_balance: '50.00' }, { current_balance: '-5.00' }], rows, month))
      .toEqual({ monthlyCollections: 100.1, yearlyCollections: 200.3, outstandingAccounts: 1, receiptsThisMonth: 2 })
  })
  it('excludes moved accounts from outstanding counts', () => {
    expect(secretaryDashboardSummary([{ homeowner_status: 'moved', current_balance: 100 }, { current_balance: 0 }], rows, month).outstandingAccounts).toBe(0)
  })
  it.each([null, '', 'NaN'])('rejects missing or malformed balances: %j', (balance) => {
    expect(() => secretaryDashboardSummary([{ current_balance: balance }], rows, month)).toThrow('balance')
  })
  it('rejects missing monthly money instead of silently reporting zero', () => {
    expect(() => secretaryDashboardSummary([], [{ ...rows[1], dues_collected: null }], month)).toThrow('collections')
  })
})
