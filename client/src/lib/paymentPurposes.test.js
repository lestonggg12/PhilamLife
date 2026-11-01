import { describe, expect, it } from 'vitest'
import { CHARGE_TYPES, PAYMENT_PURPOSES, isBalanceReducingPurpose, paymentAdvanceConfirmation } from './paymentPurposes'
import { computeMonthlyReportData, incomeTableRows, collectionsRows } from './monthlyReportData'
import { buildReceiptModel } from './receiptModel'

const advance = (paid, previous) => paymentAdvanceConfirmation({ purpose: 'Balance Payment', paid, previous })
const organization = { associationName: 'HOA', formatMoney: (n) => `PHP ${Number(n).toFixed(2)}`, formatDate: () => 'Nov 1, 2026' }

describe('Balance Payment integration', () => {
  it('is a payment purpose but cannot add another charge', () => {
    expect(PAYMENT_PURPOSES).toContain('Balance Payment')
    expect(CHARGE_TYPES).not.toContain('Balance Payment')
    expect(CHARGE_TYPES).not.toContain('Association Dues')
    expect(CHARGE_TYPES).toContain('Special Assessment')
  })
  it('does not warn when paying part or all of existing debt', () => {
    expect(advance(20000, 70000)).toBeNull()
    expect(advance(70000, 70000)).toBeNull()
    expect(advance(0, 70000)).toBeNull()
  })
  it('confirms only real excess, including existing credit, with centavo precision', () => {
    expect(advance(70000.01, 70000)).toEqual({ credit: 0.01, paid: 70000.01 })
    expect(advance(80000, 70000)).toEqual({ credit: 10000, paid: 80000 })
    expect(advance(50, -100)).toEqual({ credit: 150, paid: 50 })
  })
  it('retains dues/fee confirmation and annual-discount behavior', () => {
    expect(paymentAdvanceConfirmation({ purpose: 'Association Dues', paid: 300, previous: 100 })).toEqual({ credit: 200, paid: 300 })
    expect(paymentAdvanceConfirmation({ purpose: 'Sticker / ID Fee', paid: 100, openOfType: 40 })).toMatchObject({ credit: 60, kind: 'fee' })
    expect(paymentAdvanceConfirmation({ purpose: 'Association Dues', paid: 1100, previous: 0, annualAdvance: true })).toBeNull()
    expect(isBalanceReducingPurpose('Other')).toBe(false)
  })
  it('counts balance collections once, separately from dues and fees, in both report tables', () => {
    const payments = [
      { charge_type: 'Balance Payment', amount_paid: 20000, paid_at: '2026-11-01T01:00:00Z' },
      { charge_type: 'Association Dues', amount_paid: 100, paid_at: '2026-11-01T01:00:00Z' },
      { charge_type: 'Sticker / ID Fee', amount_paid: 50, paid_at: '2026-11-01T01:00:00Z' },
      { charge_type: 'Balance Payment', amount_paid: 500, status: 'Voided', paid_at: '2026-11-01T01:00:00Z' },
      { charge_type: 'Balance Payment', amount_paid: 1000, paid_at: '2026-10-31T15:59:59Z' },
    ]
    const report = computeMonthlyReportData({ month: '2026-11', payments })
    expect(report.income).toMatchObject({ balanceIncome: 20000, duesIncome: 100, feesIncome: 50, totalIncome: 20150 })
    expect(report.income.feeBreakdown).toEqual([{ name: 'Sticker / ID Fee', amount: 50 }])
    expect(incomeTableRows(report.income, String)).toContainEqual(['Balance payments collected', '20000'])
    expect(collectionsRows(report.receivables)).toContainEqual(['Balance payments collected this period', 'PHP 20,000.00'])
  })
  it('reopened receipts explain credit for Balance Payment without needing page-specific options', () => {
    const row = { id: 255, charge_type: 'Balance Payment', amount: 120, amount_paid: 120, previous_balance: 100, remaining_balance: -20, status: 'Completed', receipt_number: 'OR-TEST', paid_at: '2026-11-01' }
    const receipt = buildReceiptModel('payment', row, organization)
    expect(receipt.notes).toContainEqual({ label: 'Advance credit', text: 'PHP 20.00 remains as advance credit on this account.' })
    expect(buildReceiptModel('payment', { ...row, status: 'Voided' }, organization).notes.some(n => n.label === 'Advance credit')).toBe(false)
  })
})
