import { describe, expect, it } from 'vitest'
import { groupMonthlyBillingAudit, summarizeMonthlyBillingAudit } from './monthlyBillingAudit'

const bill = (id, amount = 100) => ({ id, amount, voided_at: null })
describe('monthly billing audit evidence is read-only', () => {
  it('links partial credit and unpaid portion without duplicating credit', () => {
    const rows = groupMonthlyBillingAudit([bill('a')], [
      { kind: 'credit_applied', payload: { source_id: 'a', credit_used: 75, unpaid_charge: 25 } },
      { kind: 'monthly_balance_added', payload: { source_id: 'a', credit_used: 75, unpaid_added: 25 } },
    ])
    expect(rows[0].creditUsed).toBe(75)
    expect(rows[0].unpaidAdded).toBe(25)
    expect(summarizeMonthlyBillingAudit(rows)).toMatchObject({ assessed: 100, verifiedCredit: 75, verifiedUnpaid: 25, withCredit: 1, increasedDue: 1 })
  })
  it('marks fully prepaid bills correctly', () => {
    const [row] = groupMonthlyBillingAudit([bill('b')], [
      { kind: 'credit_applied', payload: { source_id: 'b', credit_used: 100, unpaid_charge: 0 } },
    ])
    expect(row.fullyCovered).toBe(true)
    expect(row.unpaidAdded).toBe(0)
  })
  it('never reconstructs missing historical credit evidence', () => {
    const [row] = groupMonthlyBillingAudit([bill('historic')], [])
    expect(row.creditUsed).toBe(null)
    expect(row.unpaidAdded).toBe(null)
    expect(summarizeMonthlyBillingAudit([row]).unknown).toBe(1)
  })
  it('never counts voided charges toward financial totals', () => {
    const [row] = groupMonthlyBillingAudit([{ ...bill('void'), voided_at: '2026-12-04' }], [])
    expect(summarizeMonthlyBillingAudit([row]).assessed).toBe(0)
  })
  it('does not associate unrelated audit events with a charge', () => {
    const [row] = groupMonthlyBillingAudit([bill('a')], [{ kind: 'penalty_applied', payload: { source_id: 'a' } }])
    expect(row.hasEvidence).toBe(false)
  })
})
