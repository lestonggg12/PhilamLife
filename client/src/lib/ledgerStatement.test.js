import { describe, expect, it } from 'vitest'
import { buildLedgerStatement } from './ledgerStatement'

describe('buildLedgerStatement', () => {
  it('includes charges, payments, and voided history while ending at stored balance', () => {
    const result = buildLedgerStatement({
      storedBalance: 500,
      charges: [
        { id: 'charge-1', created_at: '2026-01-01', amount: 1000, charge_type: 'Association Dues' },
        { id: 'charge-2', created_at: '2026-01-05', amount: 500, charge_type: 'Special Assessment', voided_at: '2026-02-03' },
      ],
      payments: [
        { id: 'payment-1', paid_at: '2026-01-10', amount_paid: 500, balance_effect: 500, status: 'Completed' },
      ],
    })

    expect(result.lines.map((line) => line.description)).toEqual([
      'Balance brought forward',
      'Association Dues',
      'Payment',
      'Special Assessment (Voided)',
    ])
    expect(result.lines.at(-1).running_balance).toBe(500)
    expect(result.totals.charges).toBe(1500)
    expect(result.totals.payments).toBe(500)
  })

  it('keeps received payment totals separate from allocated balance effects', () => {
    const result = buildLedgerStatement({
      storedBalance: 1000,
      payments: [
        { id: 'payment-1', paid_at: '2026-01-01', amount_paid: 500, balance_effect: 0, status: 'Completed' },
      ],
    })

    expect(result.totals.payments).toBe(500)
    expect(result.totals.allocated).toBe(0)
    expect(result.lines.at(-1).running_balance).toBe(1000)
  })

  it('uses amount when amount_paid is absent', () => {
    const result = buildLedgerStatement({
      storedBalance: 0,
      payments: [{ id: 'payment-1', paid_at: '2026-01-01', amount: 250, status: 'Completed' }],
    })

    expect(result.totals.payments).toBe(250)
  })
})
