import { describe, expect, it } from 'vitest'
import { financialAuditDetails } from './financialAuditDetails'

describe('saved financial audit evidence', () => {
  it('explains partial monthly credit without inventing a payment', () => {
    const rows = financialAuditDetails({ kind: 'monthly_balance_added', payload: {
      billing_month: '2026-11-01', charge_amount: 100, credit_used: 75,
      unpaid_added: 25, balance_before: -75, balance_after: 25, source_id: 'charge-1',
    } })
    expect(rows.join(' ')).toContain('₱75.00')
    expect(rows.join(' ')).toContain('₱25.00')
    expect(rows.join(' ')).toContain('2026-11')
  })
  it('does not assign an annual penalty to an unsupported monthly due', () => {
    const rows = financialAuditDetails({ kind: 'penalty_applied', payload: {
      penalty_amount: 32.94, base_amount: 470.55, rate_formatted: '7%', charge_id: 'penalty-1',
    } })
    expect(rows.join(' ')).toContain('eligible unpaid')
    expect(rows.join(' ')).toContain('not automatically attributable to one monthly bill')
  })
  it('identifies actual penalty allocation, not the receipt label', () => {
    const rows = financialAuditDetails({ kind: 'penalty_collected', payload: {
      penalty_applied: 20, cash_received: 50, receipt_number: 'OR-EXAMPLE',
    } })
    expect(rows.join(' ')).toContain('₱20.00')
    expect(rows.join(' ')).toContain('₱50.00')
  })
  it('ignores unsupported event types and malformed amounts', () => {
    expect(financialAuditDetails({ kind: 'transaction_voided', payload: { amount: 10 } })).toEqual([])
    expect(financialAuditDetails({ kind: 'credit_applied', payload: { credit_used: 'bad' } })).toEqual([])
  })
})
