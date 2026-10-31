import { describe, expect, it } from 'vitest'
import { buildLedgerStatement, ledgerStatementNotes } from './ledgerStatement'

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

describe('complete annual advance statement', () => {
  const annualPayment = {
    id: 10, paid_at: '2026-10-31T06:00:00Z', status: 'Completed',
    amount: '12000.00', amount_paid: '11000.00', balance_effect: '12000.00', effect_released: '0.00',
    receipt_number: 'OR-2026-000010', payment_method: 'GCash', reference_number: 'GCASH-123',
    coverage_period: 'Association Dues - 12-month advance payment (1 month free)',
    note: 'Annual dues', recorded_by_name: 'Secretary',
    receipt_breakdown: { annual_advance_discount: { months_covered: 12, gross_amount: '12000.00', discount_amount: '1000.00' } },
  }
  function expectRowsToReconcile(result) {
    let running = 0
    for (const line of result.lines) {
      running = Math.round((running + line.debit - line.credit) * 100) / 100
      expect(line.running_balance).toBe(running)
    }
    expect(result.totals.totalDebits - result.totals.totalCredits).toBeCloseTo(result.totals.finalBalance, 2)
  }
  it('explains 11000 received plus 1000 non-cash discount as separate rows', () => {
    const result = buildLedgerStatement({ payments: [annualPayment], storedBalance: '-12000.00' })
    expect(result.lines.map((line) => [line.credit, line.running_balance])).toEqual([[11000, -11000], [1000, -12000]])
    expect(result.totals.payments).toBe(11000)
    expect(result.totals.annualDiscountCredit).toBe(1000)
    expect(result.totals.availableCredit).toBe(12000)
    expect(result.totals.outstandingBalance).toBe(0)
    expect(result.totals.inferredAppliedToExistingBalance).toBe(0)
    expectRowsToReconcile(result)
  })
  it('retains receipt, payment method, transfer reference, staff name and note', () => {
    const result = buildLedgerStatement({ payments: [annualPayment], storedBalance: -12000 })
    expect(result.lines[0].reference_number).toBe('OR-2026-000010')
    expect(result.lines[0].details.join(' ')).toContain('GCASH-123')
    for (const value of ['GCash', 'Secretary', 'Annual dues', '12 months', '11,000.00', '1,000.00']) {
      expect(result.lines[0].details.join(' ')).toContain(value)
    }
  })
  it('does not describe unbilled advance credit as unexplained applied payments', () => {
    const result = buildLedgerStatement({ payments: [annualPayment], storedBalance: -12000 })
    const notes = ledgerStatementNotes(result.totals, (v) => `PHP ${v}`)
    expect(notes.join(' ')).toContain('not cash received')
    expect(notes.join(' ')).toContain('future charges')
    expect(notes.join(' ')).not.toContain('existing positive balance')
    expect(notes.join(' ')).not.toContain('historical balance effects')
  })
  it('applies a later monthly bill against credit without granting the discount twice', () => {
    const result = buildLedgerStatement({
      payments: [annualPayment], storedBalance: -11000,
      charges: [{ id: 'nov', created_at: '2026-11-01T00:00:00Z', billing_month: '2026-11-01', amount: '1000.00', charge_type: 'Association Dues' }],
    })
    expect(result.totals.addedCharges).toBe(1000)
    expect(result.totals.annualDiscountCredit).toBe(1000)
    expect(result.totals.availableCredit).toBe(11000)
    expectRowsToReconcile(result)
  })
  it('excludes voided annual cash and discount while preserving explanatory history', () => {
    const result = buildLedgerStatement({ payments: [{ ...annualPayment, status: 'Voided', void_reason: 'Test void' }], storedBalance: 0 })
    expect(result.totals.payments).toBe(0)
    expect(result.totals.annualDiscountCredit).toBe(0)
    expect(result.lines).toHaveLength(2)
    expect(result.lines[0].details.join(' ')).toContain('Test void')
    expectRowsToReconcile(result)
  })
  it('shows a released effect as a separate adjustment and keeps cash totals intact', () => {
    const result = buildLedgerStatement({ payments: [{ ...annualPayment, effect_released: '500.00' }], storedBalance: -11500 })
    expect(result.lines.map((line) => line.running_balance)).toEqual([-11000, -12000, -11500])
    expect(result.totals.payments).toBe(11000)
    expect(result.totals.paymentEffectAdjustments).toBe(500)
    expectRowsToReconcile(result)
  })
  it('does not invent a one-month-free benefit when metadata is missing or inconsistent', () => {
    for (const receipt_breakdown of [null, { annual_advance_discount: { months_covered: 12, gross_amount: 12000, discount_amount: 500 } }]) {
      const result = buildLedgerStatement({ payments: [{ ...annualPayment, receipt_breakdown }], storedBalance: -12000 })
      expect(result.totals.annualDiscountCredit).toBe(0)
      expect(result.totals.additionalRecordedCredit).toBe(1000)
      expect(ledgerStatementNotes(result.totals, String).join(' ')).toContain('verify the supporting record')
      expectRowsToReconcile(result)
    }
  })
  it('preserves centavos exactly in annual amounts', () => {
    const payment = { ...annualPayment, amount: '12000.12', amount_paid: '11000.11', balance_effect: '12000.12', receipt_breakdown: { annual_advance_discount: { months_covered: 12, gross_amount: '12000.12', discount_amount: '1000.01' } } }
    const result = buildLedgerStatement({ payments: [payment], storedBalance: '-12000.12' })
    expect(result.totals.payments).toBe(11000.11)
    expect(result.totals.annualDiscountCredit).toBe(1000.01)
    expect(result.totals.availableCredit).toBe(12000.12)
    expectRowsToReconcile(result)
  })
  it('shows unapplied cash as an adjustment rather than silently breaking a row equation', () => {
    const result = buildLedgerStatement({ payments: [{ id: 1, amount_paid: '500.00', balance_effect: '0.00', status: 'Completed' }], openingBalance: '1000.00', storedBalance: '1000.00' })
    expect(result.totals.unallocated).toBe(500)
    expect(result.totals.payments).toBe(500)
    expectRowsToReconcile(result)
  })
  it('keeps charges and opening balance distinct and reports a real mismatch', () => {
    const result = buildLedgerStatement({ openingBalance: '1000.00', openingBalanceAsOf: '2025-12-31', storedBalance: '1700.00', charges: [{ id: 1, amount: '500.00', created_at: '2026-01-01' }] })
    expect(result.totals.openingBalance).toBe(1000)
    expect(result.totals.addedCharges).toBe(500)
    expect(result.lines[0].transaction_date).toBe('2025-12-31')
    expect(result.totals.reconciliationDifference).toBe(-200)
    expect(ledgerStatementNotes(result.totals, String).join(' ')).toContain('does not match')
    expectRowsToReconcile(result)
  })
})


describe('documented account adjustments', () => {
  it('includes the saved credit correction without counting it as money received', () => {
    const result = buildLedgerStatement({
      openingBalance: '19000.00', storedBalance: '7570.00',
      payments: [{ id: 7, amount_paid: '5000.00', balance_effect: '5000.00', paid_at: '2026-10-25T15:50:00Z' }, { id: 8, amount_paid: '3430.00', balance_effect: '3430.00', paid_at: '2026-10-25T15:53:00Z' }],
      adjustments: [{ id: 'correction', balance_effect: '-3000.00', reason: 'Balance received from previous account', approval_reference: 'TRANSFER-1', created_at: '2026-10-25T15:16:00Z' }],
    })
    expect(result.totals.finalBalance).toBe(7570)
    expect(result.totals.payments).toBe(8430)
    expect(result.totals.netOtherAdjustments).toBe(-3000)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
    expect(result.lines.find(l=>l.kind==='account-adjustment')).toMatchObject({ credit: 3000, reference_number: 'TRANSFER-1' })
  })
  it('retains reversed adjustments without applying them again', () => {
    const result = buildLedgerStatement({ storedBalance: 0, adjustments: [{ id: 'reversed', balance_effect: 3000, reversed_at: '2026-10-31', reversal_reason: 'Correction cancelled' }] })
    expect(result.lines[0].voided).toBe(true)
    expect(result.totals.documentedAccountAdjustments).toBe(0)
    expect(result.lines[0].debit).toBe(0)
    expect(result.totals.payments).toBe(0)
  })
})
