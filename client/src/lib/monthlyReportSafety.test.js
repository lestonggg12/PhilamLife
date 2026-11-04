import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  computeMonthlyReportData,
  verifyReportReceivables,
  monthDateBounds,
} from './monthlyReportData'

const credits = {
  active_credit_total: '25.25',
  active_credit_accounts: 1,
  moved_credit_total: '10.00',
  moved_credit_accounts: 1,
}

describe('Monthly report financial safety', () => {
  it('reconciles active and moved advance credits exactly', () => {
    const properties = [
      { id: 1, current_balance: '-25.25', homeowner_status: 'active' },
      { id: 2, current_balance: '100.00', homeowner_status: 'active' },
      { id: 3, current_balance: '-10.00', homeowner_status: 'moved' },
    ]
    const overdue = [
      { property_id: 1, balance: '0.00' },
      { property_id: 2, balance: '100.00' },
    ]
    expect(() => verifyReportReceivables(properties, overdue, credits)).not.toThrow()
    expect(() => verifyReportReceivables(properties, overdue, {
      ...credits, active_credit_total: '25.24',
    })).toThrow('reconcile')
    expect(() => verifyReportReceivables(properties, overdue, {
      ...credits, moved_credit_accounts: 0,
    })).toThrow('reconcile')
    expect(() => verifyReportReceivables(properties, overdue, {
      ...credits, moved_credit_total: null,
    })).toThrow('incomplete')
  })

  it('rejects missing and malformed monetary amounts', () => {
    for (const amount of [null, '', 'NaN', 'Infinity', '0.001', '100.345']) {
      expect(() => computeMonthlyReportData({
        month: '2026-11',
        payments: [{
          paid_at: '2026-11-04T12:00:00+08:00',
          status: 'Completed',
          amount_paid: amount,
        }],
      })).toThrow()
    }
    expect(() => computeMonthlyReportData({
      month: '2026-11',
      expenses: [{
        expense_date: '2026-11-04',
        status: 'Completed',
        amount: null,
      }],
    })).toThrow()
  })

  it('keeps original centavos and excludes all void statuses', () => {
    const report = computeMonthlyReportData({
      month: '2026-11',
      payments: [
        { paid_at: '2026-11-03T12:00:00+08:00', amount_paid: '0.10' },
        { paid_at: '2026-11-04T12:00:00+08:00', amount_paid: '0.20' },
        { paid_at: '2026-11-04T12:00:00+08:00', amount_paid: '500.00', status: 'VOIDED' },
      ],
      expenses: [{ expense_date: '2026-11-04', amount: '0.05' }],
    })
    expect(report.kpis.totalIncome).toBe(0.30)
    expect(report.kpis.totalExpenses).toBe(0.05)
    expect(report.kpis.netIncome).toBe(0.25)
  })

  it('preserves calendar year boundaries and leap years', () => {
    expect(monthDateBounds('2026-12').to).toBe('2026-12-31')
    expect(monthDateBounds('2027-01').from).toBe('2027-01-01')
    expect(monthDateBounds('2028-02').to).toBe('2028-02-29')
  })

  it('never shows old totals as a verified new-month report', () => {
    const source = readFileSync(
      new URL('../pages/ReportsPage.jsx', import.meta.url), 'utf8',
    )
    expect(source).toContain("setVerifiedMonth('')")
    expect(source).toContain('verifiedMonth !== month')
    expect(source).toContain('Monthly report unavailable')
    expect(source).toContain('!report || loadFailure')
    expect(source).toContain('status.not.ilike.voided')
  })
})
