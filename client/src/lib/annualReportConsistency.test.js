import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { annualReportTotals, buildAnnualReportView } from './annualReportData'

const emptyCredits = { active_credit_total: 0, active_credit_accounts: 0, moved_credit_total: 0, moved_credit_accounts: 0 }

describe('Annual financial record consistency and display', () => {
  it('hides future months AND excludes future-period money from annual totals', () => {
    const data = annualReportTotals(2026, [
      { month_start: '2026-10-01', dues_collected: '100.00', service_collected: '5.00' },
      { month_start: '2026-12-01', dues_collected: '200.00', service_collected: '0.00' },
    ], [
      { expense_date: '2026-10-15', amount: '10.00', status: 'Completed' },
      { expense_date: '2026-12-15', amount: '90.00', status: 'Completed' },
    ], '2026-11')
    expect(data.income).toBe(105)
    expect(data.expenses).toBe(10)
    expect(data.net).toBe(95)
    expect(data.months[11].future).toBe(true)
    expect(data.months[11].income).toBe(0)
  })

  it('reconciles annual source records even when future-dated transactions exist', () => {
    const result = buildAnnualReportView({
      year: 2026, currentMonth: '2026-11', datePrepared: 'November 5, 2026',
      collections: [
        { month_start: '2026-10-01', dues_collected: '100.00', service_collected: '0.00' },
        { month_start: '2026-12-01', dues_collected: '200.00', service_collected: '0.00' },
      ],
      payments: [
        { paid_at: '2026-10-15T12:00:00+08:00', amount_paid: '100.00', charge_type: 'Association Dues' },
        { paid_at: '2026-12-15T12:00:00+08:00', amount_paid: '200.00', charge_type: 'Association Dues' },
      ],
      expenses: [], serviceTransactions: [], properties: [], overdue: [], credits: emptyCredits,
      documents: [], events: [],
      grievances: { opening: 0, received: 0, reopened: 0, resolved: 0, dismissed: 0, withdrawn: 0, closing: 0, over_30_days: 0 },
    })
    expect(result.kpis.totalIncome).toBe(100)
    expect(result.narrative.overview).toContain('recorded during the reporting year')
    expect(result.narrative.overview).not.toContain('scheduled for the period')
  })

  it('has no garbled punctuation in the annual page', () => {
    const page = readFileSync(new URL('../pages/AnnualReportsPage.jsx', import.meta.url), 'utf8')
    for (const bad of ['â€”', 'â€“', 'â€¦', 'Ã¢']) expect(page).not.toContain(bad)
    expect(page).toContain("m.future ? '--' : fmt(v)")
  })
})
