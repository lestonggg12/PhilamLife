import { describe, expect, it } from 'vitest'
import { annotateLedgerStatementEvidence } from './ledgerAuditAnnotations'

const charge = { id: 'charge-c1', kind: 'charge', debit: 100, credit: 0, running_balance: 25, details: ['Monthly dues'] }
const payment = { id: 'payment-22', kind: 'payment', debit: 0, credit: 20, running_balance: 5, details: ['Cash received'] }

describe('ledger evidence annotations are non-financial', () => {
  it('shows a partial credit only once and does not change accounting totals', () => {
    const events = [
      { kind: 'credit_applied', payload: { source_id: 'c1', credit_used: 75, charge_amount: 100 } },
      { kind: 'monthly_balance_added', payload: { source_id: 'c1', credit_used: 75, unpaid_added: 25 } },
    ]
    const [row] = annotateLedgerStatementEvidence([charge], events)
    expect(row.details.join(' ')).toContain('₱75.00')
    expect(row.details.join(' ')).toContain('₱25.00')
    expect(row.details.filter(x => x.startsWith('Advance credit consumed'))).toHaveLength(1)
    expect([row.debit, row.credit, row.running_balance]).toEqual([100, 0, 25])
    expect(charge.details).toEqual(['Monthly dues'])
  })
  it('does not attribute an annual penalty to an invented dues month', () => {
    const [row] = annotateLedgerStatementEvidence([charge], [{ kind: 'penalty_applied', payload: {
      charge_id: 'c1', penalty_amount: 32.94, base_amount: 470.55, rate_formatted: '7%',
    } }])
    expect(row.details.join(' ')).toContain('₱32.94')
    expect(row.details.join(' ')).toContain('not automatically attributable to one monthly bill')
  })
  it('uses actual penalty allocation and does not duplicate the cash receipt', () => {
    const [row] = annotateLedgerStatementEvidence([payment], [{ kind: 'penalty_collected', payload: {
      source_id: 22, penalty_applied: 12, cash_received: 20,
    } }])
    expect(row.details.join(' ')).toContain('₱12.00')
    expect(row.details.join(' ')).toContain('NOT a second collection')
    expect(row.credit).toBe(20)
  })
  it('ignores unrelated or unlinked evidence', () => {
    const [row] = annotateLedgerStatementEvidence([charge], [
      { kind: 'monthly_balance_added', payload: { source_id: 'other', unpaid_added: 25 } },
      { kind: 'transaction_voided', payload: { source_id: 'c1', amount: 10 } },
    ])
    expect(row).toBe(charge)
  })
})
