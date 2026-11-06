import { describe, expect, it } from 'vitest'
import { secretaryRoleReport, treasurerRoleReport } from './roleReportData'

const grievances = { opening: 0, received: 1, reopened: 0, resolved: 1,
  dismissed: 0, withdrawn: 0, closing: 0, over_30_days: 0 }
const secretaryInput = {
  month: '2026-11',
  grievances,
  events: [{ title: 'Board Meeting', event_date: '2026-11-12', location: 'Clubhouse' }],
  documents: [
    { title: 'Board Meeting Minutes', category: 'Minutes', created_at: '2026-11-02T10:00:00+08:00' },
    { title: 'DHSUD notice draft', category: 'Legal', created_at: '2026-11-02T10:00:00+08:00' },
  ],
  properties: [{ id: 1, block: 'A', lot_number: 4, homeowner_name: 'Sample Member',
    homeowner_status: 'active', created_at: '2026-11-04T09:00:00+08:00', status_updated_at: null }],
}
const treasuryInput = {
  month: '2026-11', snapshotDate: '2026-11-06',
  payments: [{ charge_type: 'Association Dues', amount_paid: '100.00' }],
  services: [{ service_name: 'Gate Pass', amount_paid: '50.00' }],
  expenses: [{ category: 'Security', description: 'Guard', reference_number: 'R-12',
    expense_date: '2026-11-01', amount: '90.00' }],
  properties: [{ id: 1, block: 'A', lot_number: 4, homeowner_name: 'Sample Member', homeowner_status: 'active' }],
  overdue: [{ property_id: 1, is_overdue: true, days_overdue: 37, overdue_amount: '20.00', aging_complete: true }],
  budgets: [],
  collectionActions: [{ property_id: 1, action_date: '2026-11-06T10:00:00+08:00', action_type: 'Reminder' }],
}

describe('role report contexts', () => {
  it('uses the five requested Secretary duty sections', () => {
    const report = secretaryRoleReport(secretaryInput)
    expect(report.sections.map(s => s.title)).toEqual([
      '1. Meeting Minutes', '2. Correspondence and Notices',
      '3. Membership and Roster Updates', '4. Pending Actions and Resolutions',
      '5. Custodianship of Records',
    ])
    expect(report.sections[0].tables[0].rows).toHaveLength(1)
    expect(report.sections[1].note).toMatch(/DHSUD/)
  })

  it('does not claim a property update is a title transfer', () => {
    const report = secretaryRoleReport(secretaryInput)
    expect(report.sections[2].note).toMatch(/transfers/)
  })

  it('uses the six requested Treasurer report sections', () => {
    const report = treasurerRoleReport(treasuryInput)
    expect(report.sections.map(s => s.title)).toEqual([
      '1. Cash Position and Balances', '2. Income Summary',
      '3. Expense Summary and Disbursements', '4. Budget vs. Actual Comparison',
      '5. Delinquency Report', '6. Accounts Payable and Reconciliations',
    ])
    expect(report.metrics[0][1]).toBe('PHP 150.00')
    expect(report.metrics[1][1]).toBe('PHP 90.00')
    expect(report.metrics[2][1]).toBe('PHP 60.00')
  })

  it('uses real aging data and labels current balances as snapshots', () => {
    const report = treasurerRoleReport(treasuryInput)
    expect(report.sections[4].intro).toContain('2026-11-06')
    expect(report.sections[4].tables[0].rows[1]).toEqual(['31–60 days', '1', 'PHP 20.00'])
    expect(report.sections[4].tables[1].rows).toHaveLength(1)
  })

  it('fails closed on incomplete overdue aging or financial amounts', () => {
    expect(() => treasurerRoleReport({ ...treasuryInput,
      overdue: [{ ...treasuryInput.overdue[0], aging_complete: false }] })).toThrow(/aging is incomplete/i)
    expect(() => treasurerRoleReport({ ...treasuryInput,
      payments: [{ amount_paid: null }] })).toThrow(/required amount/i)
  })
})
