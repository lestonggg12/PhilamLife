
import { describe, expect, it } from 'vitest'
import { annualReportTotals } from './annualReportData'

describe('annual management report', () => {
  it('reconciles homeowner, service, expense and net totals in centavos', () => {
    const report = annualReportTotals(2026, [
      { month_start: '2026-10-01', dues_collected: '1593222.83', service_collected: '0.00' },
      { month_start: '2026-11-01', dues_collected: '147347.68', service_collected: '775.00' },
    ], [
      { expense_date: '2026-11-03', amount: '9500.00', status: 'Completed' },
      { expense_date: '2026-11-03', amount: '999.00', status: 'Voided' },
    ], '2026-11')
    expect(report.months).toHaveLength(12)
    expect(report.income).toBe(1741345.51)
    expect(report.expenses).toBe(9500)
    expect(report.net).toBe(1731845.51)
    expect(report.months[11].future).toBe(true)
  })

  it('never treats missing or corrupt income as zero', () => {
    expect(() => annualReportTotals(2026, [
      { month_start: '2026-10-01', dues_collected: null, service_collected: 0 },
    ], [], '2026-11')).toThrow()
    expect(() => annualReportTotals(2026, [
      { month_start: '2026-10-01', dues_collected: '0.001', service_collected: 0 },
    ], [], '2026-11')).toThrow()
  })

  it('rejects duplicate monthly summaries', () => {
    expect(() => annualReportTotals(2026, [
      { month_start: '2026-10-01', dues_collected: 1, service_collected: 0 },
      { month_start: '2026-10-01', dues_collected: 1, service_collected: 0 },
    ], [], '2026-11')).toThrow('Duplicate')
  })

  it('keeps 2026 and 2027 as separate reporting years', () => {
    const report = annualReportTotals(2027, [
      { month_start: '2027-01-01', dues_collected: '5.00', service_collected: '0.00' },
    ], [], '2027-01')
    expect(report.income).toBe(5)
    expect(report.months[0].month).toBe('2027-01')
    expect(report.months[11].month).toBe('2027-12')
  })
})
