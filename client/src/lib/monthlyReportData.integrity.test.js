import { describe, expect, it } from 'vitest'
import { monthDateBounds, computeMonthlyReportData, verifyReportReceivables } from './monthlyReportData'

const base = { payments: [], serviceTransactions: [], expenses: [], properties: [], overdue: [], credits: { active_credit_total: 0, active_credit_accounts: 0, moved_credit_total: 0, moved_credit_accounts: 0 }, documents: [], events: [], month: '2026-11' }

describe('monthly report boundaries and integrity', () => {
  it.each([
    ['2026-11', '2026-11-30'],
    ['2026-12', '2026-12-31'],
    ['2028-02', '2028-02-29'],
    ['2027-02', '2027-02-28'],
  ])('ends %s on its actual last calendar day', (month, end) => {
    expect(monthDateBounds(month)).toEqual({ from: `${month}-01`, to: end })
  })
  it('refuses malformed report months', () => {
    expect(() => monthDateBounds('2026-13')).toThrow('Invalid')
  })
  it('does not count cancelled payments and expenses even if returned unfiltered', () => {
    const report = computeMonthlyReportData({ ...base,
      payments: [{ paid_at: '2026-11-04T10:00:00+08:00', status: 'voided', amount_paid: 150 }],
      expenses: [{ expense_date: '2026-11-04', status: 'Voided', amount: 200 }],
    })
    expect(report.kpis.totalIncome).toBe(0)
    expect(report.kpis.totalExpenses).toBe(0)
    expect(report.expenses.entryCount).toBe(0)
  })
  it('requires every active property to have an accurate receivable balance', () => {
    const properties = [{ id: 12, homeowner_status: 'active', current_balance: '150.00' }]
    const overdue = [{ property_id: 12, balance: '150.00', is_overdue: true }]
    expect(() => verifyReportReceivables(properties, overdue, base.credits)).not.toThrow()
    expect(() => verifyReportReceivables(properties, [], base.credits)).toThrow('incomplete')
    expect(() => verifyReportReceivables(properties, [{ property_id: 12, balance: '149.99' }], base.credits)).toThrow('incomplete')
    expect(() => verifyReportReceivables(properties, overdue, null)).toThrow('unavailable')
  })
  it('does not require receivables for closed homeowner accounts', () => {
    expect(() => verifyReportReceivables([{ id: 5, homeowner_status: 'moved', current_balance: 80 }], [], base.credits)).not.toThrow()
  })
})
