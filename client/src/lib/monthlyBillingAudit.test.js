import { describe, expect, it } from 'vitest'
import { buildCurrentDuesPeriodQuery, groupMonthlyBillingAudit, summarizeMonthlyBillingAudit } from './monthlyBillingAudit'

const bill = (id, amount = 100) => ({ id, amount, voided_at: null })
describe('monthly billing audit evidence is read-only', () => {
  it('links partial credit and unpaid portion without duplicating credit', () => {
    const rows = groupMonthlyBillingAudit([bill('a')], [
      { kind: 'credit_applied', payload: { source_id: 'a', credit_used: 75, unpaid_charge: 25 } },
      { kind: 'monthly_balance_added', payload: { source_id: 'a', credit_used: 75, unpaid_added: 25 } },
    ], [{ kind: 'dues', category: 'Association Dues', ref_id: 'a', unpaid: 25 }])
    expect(rows[0].creditUsed).toBe(75)
    expect(rows[0].unpaidAdded).toBe(25)
    expect(summarizeMonthlyBillingAudit(rows)).toMatchObject({ accountsBilled: 1, assessed: 100, verifiedCredit: 75, verifiedUnpaid: 25, withCredit: 1, increasedDue: 1, applied: 1, needsReview: null })
  })
  it('marks fully prepaid bills correctly', () => {
    const [row] = groupMonthlyBillingAudit([bill('b')], [
      { kind: 'credit_applied', payload: { source_id: 'b', credit_used: 100, unpaid_charge: 0 } },
    ], [{ kind: 'dues', category: 'Association Dues', ref_id: 'b', unpaid: 0 }])
    expect(row.fullyCovered).toBe(true)
    expect(row.unpaidAdded).toBe(0)
    expect(row).toMatchObject({ currentUnpaid: 0, hasCurrentSettlement: true })
  })
  it('never reconstructs missing historical credit evidence', () => {
    const [row] = groupMonthlyBillingAudit([bill('historic')], [], [
      { kind: 'dues', category: 'Association Dues', ref_id: 'historic', unpaid: 0 },
    ])
    expect(row.creditUsed).toBe(null)
    expect(row.unpaidAdded).toBe(null)
    expect(row.currentUnpaid).toBe(0)
    expect(summarizeMonthlyBillingAudit([row]).unknown).toBe(1)
  })
  it('shows a partially unpaid current dues position without changing historical evidence', () => {
    const [row] = groupMonthlyBillingAudit([bill('partial')], [
      { kind: 'monthly_balance_added', payload: { source_id: 'partial', unpaid_added: 25 } },
    ], [{ kind: 'dues', category: 'Association Dues', ref_id: 'partial', unpaid: 10 }])
    expect(row).toMatchObject({ unpaidAdded: 25, currentUnpaid: 10, hasCurrentSettlement: true })
  })
  it('marks current settlement unavailable when the ledger view cannot be read', () => {
    const [row] = groupMonthlyBillingAudit([bill('unavailable')], [], null)
    expect(row).toMatchObject({ currentUnpaid: null, hasCurrentSettlement: false })
  })
  it('keeps null current unpaid unavailable instead of treating it as zero', () => {
    const [row] = groupMonthlyBillingAudit([bill('missing-unpaid')], [], [
      { kind: 'dues', category: 'Association Dues', ref_id: 'missing-unpaid', unpaid: null },
    ])
    expect(row).toMatchObject({ currentUnpaid: null, hasCurrentSettlement: false })
  })
  it('never counts voided charges toward financial totals', () => {
    const [row] = groupMonthlyBillingAudit([{ ...bill('void'), voided_at: '2026-12-04' }], [])
    expect(summarizeMonthlyBillingAudit([row]).assessed).toBe(0)
  })
  it('counts distinct nonvoided property accounts while retaining each valid charge in assessed totals', () => {
    const rows = groupMonthlyBillingAudit([
      { ...bill('first', 100), property_id: 7 },
      { ...bill('second', 50), property_id: 7 },
      { ...bill('voided', 99), property_id: 8, voided_at: '2026-11-02' },
    ], [])
    expect(summarizeMonthlyBillingAudit(rows)).toMatchObject({ accountsBilled: 1, assessed: 150, applied: 1 })
  })
  it('does not create a needs-review discrepancy from missing historical evidence or unavailable balances', () => {
    const [row] = groupMonthlyBillingAudit([bill('unverified')], [], null)
    expect(row).toMatchObject({ billingStatus: 'applied', previousBalance: null, balanceAfterBilling: null })
    expect(summarizeMonthlyBillingAudit([row]).needsReview).toBeNull()
  })
  it('does not associate unrelated audit events with a charge', () => {
    const [row] = groupMonthlyBillingAudit([bill('a')], [{ kind: 'penalty_applied', payload: { source_id: 'a' } }])
    expect(row.hasEvidence).toBe(false)
  })
  it('builds the November current-dues lookup by period, not hundreds of charge IDs', () => {
    const calls = []
    const query = {
      select: (...args) => { calls.push(['select', ...args]); return query },
      eq: (...args) => { calls.push(['eq', ...args]); return query },
      gte: (...args) => { calls.push(['gte', ...args]); return query },
      lt: (...args) => { calls.push(['lt', ...args]); return query },
      in: (...args) => { calls.push(['in', ...args]); return query },
    }
    buildCurrentDuesPeriodQuery(query, { view: 'month', month: '2026-11', year: '2026' })
    expect(calls).toEqual([
      ['select', 'kind,category,ref_id,unpaid'],
      ['eq', 'kind', 'dues'],
      ['eq', 'category', 'Association Dues'],
      ['eq', 'item_date', '2026-11-01'],
    ])
    expect(calls.find(([method]) => method === 'in')).toBeUndefined()
  })
})
