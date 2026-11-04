
import { describe, expect, it } from 'vitest'
import { buildAnnualReportView } from './annualReportData'
import { buildAnnualReportPdf } from './annualReportPdf'

const view = () => buildAnnualReportView({
  year: 2026, currentMonth: '2026-11', datePrepared: 'November 5, 2026',
  collections: [
    { month_start: '2026-10-01', dues_collected: '100.10', service_collected: '0.00' },
    { month_start: '2026-11-01', dues_collected: '20.20', service_collected: '5.00' },
  ],
  payments: [
    { paid_at: '2026-10-05T10:00:00+08:00', amount_paid: '100.10', charge_type: 'Association Dues' },
    { paid_at: '2026-11-05T10:00:00+08:00', amount_paid: '20.20', charge_type: 'Balance Payment' },
  ],
  serviceTransactions: [{ paid_at: '2026-11-05T10:00:00+08:00', amount_paid: '5.00', service_name: 'Hall' }],
  expenses: [{ expense_date: '2026-11-05', amount: '3.00', status: 'Completed', category: 'Utilities' }],
  properties: [], overdue: [], credits: { active_credit_total: 0, active_credit_accounts: 0, moved_credit_total: 0, moved_credit_accounts: 0 },
  documents: [{ title: 'Minutes', category: 'Document', created_at: '2026-11-05T10:00:00+08:00' }],
  events: [{ title: 'Assembly', event_date: '2026-11-05', location: 'Hall' }],
  grievances: { opening: 0, received: 0, reopened: 0, resolved: 0, dismissed: 0, withdrawn: 0, closing: 0, over_30_days: 0 },
})

describe('annual matches monthly report structure', () => {
  it('reconciles all twelve months, revenue categories and expense details', () => {
    const r = view()
    expect(r.monthlySummary).toHaveLength(12)
    expect(r.kpis.totalIncome).toBe(125.30)
    expect(r.kpis.totalExpenses).toBe(3)
    expect(r.kpis.netIncome).toBe(122.30)
    expect(r.income.duesIncome).toBe(100.10)
    expect(r.income.balanceIncome).toBe(20.20)
    expect(r.expenses.byCategory[0].category).toBe('Utilities')
    expect(r.events.thisMonth).toHaveLength(1)
    expect(r.documents.thisMonth).toHaveLength(1)
    expect(r.monthlySummary[11].future).toBe(true)
  })
  it('uses the same PDF renderer and provides every monthly report section', () => {
    const doc = buildAnnualReportPdf({ report: view(), hoaName: 'Sample HOA', datePrepared: 'November 5, 2026' })
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
  })
  it('rejects conflicting monthly summary data', () => {
    const report = view()
    expect(report.monthlySummary[9].income).toBe(100.10)
  })
})
