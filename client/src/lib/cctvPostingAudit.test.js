import { describe, expect, it } from 'vitest'
import { cctvPostingAudit } from './cctvPostingAudit'

const schedule = { id: 's1', starts_on: '2026-11-01', ends_before: null, monthly_credit: '150.00' }
const charge = { id: 'c1', charge_type: 'Association Dues', billing_month: '2026-11-01', amount: '456.85', voided_at: null }
const credit = { charge_id: 'c1', approval_reference: 'CCTV:c1:s1', balance_effect: '-150.00', reversed_at: null }

describe('CCTV posting audit', () => {
  it('does not call an approved, unbilled month a posted credit', () => {
    expect(cctvPostingAudit(schedule)).toMatchObject({ billedMonths: 0, postedMonths: 0, postedAmount: 0, issues: [] })
  })
  it('verifies one exact posted credit against its monthly charge', () => {
    expect(cctvPostingAudit(schedule, [charge], [credit])).toMatchObject({ billedMonths: 1, postedMonths: 1, postedAmount: 150, issues: [] })
  })
  it('detects a missing posting even when the account balance might reconcile', () => {
    expect(cctvPostingAudit(schedule, [charge], []).issues).toHaveLength(1)
  })
  it('detects a duplicate posting and a wrong schedule reference', () => {
    expect(cctvPostingAudit(schedule, [charge], [credit, credit]).issues).toHaveLength(1)
    expect(cctvPostingAudit(schedule, [charge], [{ ...credit, approval_reference: 'CCTV:c1:other' }]).issues).toHaveLength(1)
  })
  it('ignores reversed credits, voided bills, and months outside the schedule', () => {
    expect(cctvPostingAudit(schedule, [charge], [{ ...credit, reversed_at: '2026-11-11' }]).issues).toHaveLength(1)
    expect(cctvPostingAudit(schedule, [{ ...charge, voided_at: '2026-11-11' }], [credit]).billedMonths).toBe(0)
    expect(cctvPostingAudit(schedule, [{ ...charge, billing_month: '2026-10-01' }], [credit]).billedMonths).toBe(0)
  })
  it('flags orphan credits when an underlying charge was voided or removed', () => {
    const orphan = { ...credit, charge_id: 'voided-bill', approval_reference: 'CCTV:voided-bill:s1' }
    expect(cctvPostingAudit(schedule, [], [orphan]).issues).toHaveLength(1)
  })
  it('caps expected compensation at the monthly dues amount', () => {
    expect(cctvPostingAudit(schedule, [{ ...charge, amount: '100.00' }], [{ ...credit, balance_effect: '-100.00' }]).issues).toHaveLength(0)
  })
})
