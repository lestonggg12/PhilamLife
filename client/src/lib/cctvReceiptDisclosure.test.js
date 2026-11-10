import { describe, expect, it } from 'vitest'
import { buildPreprintedFields } from './preprintedReceipt'
import { buildReceiptModel } from './receiptModel'

const receipt = (snapshot) => buildPreprintedFields('payment', {
  amount_paid: 600, previous_balance: 600, homeowner_name: 'Test Lot',
  receipt_breakdown: snapshot ? { cctv_credit_snapshot: snapshot } : {},
  charge_type: 'Association Dues',
})

describe('CCTV electricity credit receipt disclosure', () => {
  it('shows recorded non-cash credits without changing the actual cash received', () => {
    const f = receipt({ total: '200.00', months: 1 })
    expect(f.discountNote).toContain('CCTV credits on account: -200.00')
    expect(f.totalSales).toBe('600.00')
    expect(f.totalPaid).toBe('600.00')
    expect(f.discount).toBe('')
  })
  it('does not claim a credit merely because a schedule was approved', () => {
    expect(receipt(null).discountNote).toBe('')
  })
  it('shows a separate non-cash credit explanation on the digital receipt', () => {
    const org = { associationName: 'PHILAM', address: '', contactPhone: '', contactEmail: '',
      formatMoney: (n) => `₱${Number(n).toFixed(2)}`, formatDate: () => '' }
    const model = buildReceiptModel('payment', { id: 1, receipt_number: 'OR-TEST',
      amount_paid: 600, previous_balance: 600, remaining_balance: 0,
      charge_type: 'Association Dues', status: 'Completed',
      receipt_breakdown: { cctv_credit_snapshot: { total: '200.00', months: 1 } } }, org)
    expect(model.summary.find((item) => item.label === 'Amount paid')?.value).toBe('₱600.00')
    const note = model.notes.find((item) => item.label === 'CCTV Electricity Compensation')
    expect(note?.text).toContain('not deducted from this cash payment')
    expect(model.preprinted.totalPaid).toBe('600.00')
  })
  it('never double-subtracts CCTV from cash on a later receipt', () => {
    const f = receipt({ total: '450.00', months: 3 })
    expect(f.totalSales).toBe('600.00')
    expect(f.totalPaid).toBe('600.00')
  })
})
