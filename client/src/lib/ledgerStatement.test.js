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
      'Association Dues',
      'Payment',
      'Special Assessment (Voided)',
    ])
    expect(result.lines.at(-1).running_balance).toBe(500)
    expect(result.totals.openingBalance).toBe(0)
    expect(result.totals.charges).toBe(1000)
    expect(result.totals.payments).toBe(500)
    expect(result.totals.unallocated).toBe(0)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
  })

  it('does not invent an opening balance for a voided payment on an empty account', () => {
    const result = buildLedgerStatement({
      storedBalance: 0,
      charges: [],
      payments: [
        { id: 'payment-1', paid_at: '2026-01-10', amount_paid: 500, balance_effect: 500, status: 'Voided' },
      ],
    })

    expect(result.totals.openingBalance).toBe(0)
    expect(result.totals.finalBalance).toBe(0)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
    expect(result.lines.at(-1).running_balance).toBe(0)
  })

  it('reconciles an explicit opening balance when a payment was voided', () => {
    const result = buildLedgerStatement({
      storedBalance: 3000,
      openingBalance: 3000,
      charges: [
        { id: 'charge-1', created_at: '2026-10-03', amount: 1000, charge_type: 'Association Dues' },
      ],
      payments: [
        { id: 'payment-1', paid_at: '2026-10-05', amount_paid: 1000, balance_effect: 1000, status: 'Voided' },
        { id: 'payment-2', paid_at: '2026-10-06', amount_paid: 1000, balance_effect: 1000, status: 'Completed' },
      ],
    })

    expect(result.totals.finalBalance).toBe(3000)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
    expect(result.totals.reconciliationDifference).toBe(0)
  })

  it('ignores a voided charge and its released payment effect in the running balance', () => {
    const result = buildLedgerStatement({
      storedBalance: 0,
      charges: [
        { id: 'a', created_at: '2026-10-17T01:21:09Z', charge_type: 'Special Assessment', amount: 1000 },
        { id: 'b', created_at: '2026-10-17T01:21:28Z', charge_type: 'Special Assessment', amount: 500, voided_at: '2026-10-17T01:43:26Z' },
        { id: 'c', created_at: '2026-10-17T01:26:56Z', charge_type: 'Special Assessment', amount: 200, voided_at: '2026-10-17T01:29:48Z' },
      ],
      payments: [
        { id: 801, paid_at: '2026-10-17T01:24:20Z', coverage_period: 'Special Assessment', amount_paid: 1500, balance_effect: 1500, effect_released: 500, status: 'Completed' },
      ],
    })

    expect(result.totals.openingBalance).toBe(0)
    expect(result.totals.charges).toBe(1000)
    expect(result.totals.finalBalance).toBe(0)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
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
    expect(result.totals.unallocated).toBe(500)
    expect(result.lines.at(-1).running_balance).toBe(1000)
  })

  it('reports an inferred opening balance instead of hiding incomplete history', () => {
    const result = buildLedgerStatement({
      storedBalance: 1000,
      charges: [{ id: 'charge-1', created_at: '2026-01-01', amount: 1000, charge_type: 'Association Dues' }],
    })

    expect(result.totals.inferredOpeningBalance).toBe(0)

    const incomplete = buildLedgerStatement({ storedBalance: 1500, charges: [] })
    expect(incomplete.totals.inferredOpeningBalance).toBe(1500)
  })

  it('uses amount when amount_paid is absent', () => {
    const result = buildLedgerStatement({
      storedBalance: 0,
      payments: [{ id: 'payment-1', paid_at: '2026-01-01', amount: 250, status: 'Completed' }],
    })

    expect(result.totals.payments).toBe(250)
  })

  it('separates explicit allocations from inferred payment effects', () => {
    const result = buildLedgerStatement({
      storedBalance: 0,
      payments: [{
        id: 'payment-1',
        paid_at: '2026-01-01',
        amount_paid: 100,
        balance_effect: 100,
        status: 'Completed',
        allocations: [{ allocated_amount: 40 }],
      }],
    })

    expect(result.totals.allocated).toBe(100)
    expect(result.totals.explicitlyAllocated).toBe(40)
    expect(result.totals.inferredAllocated).toBe(60)
  })
})