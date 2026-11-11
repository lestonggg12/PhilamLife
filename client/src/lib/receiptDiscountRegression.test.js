import { describe, expect, it } from 'vitest'
import { buildReceiptModel } from './receiptModel'

const organization = {
  associationName: 'PHILAM Village',
  address: 'Cagayan de Oro City',
  contactPhone: '',
  contactEmail: '',
  formatMoney: (value) => `PHP ${Number(value).toFixed(2)}`,
  formatDate: (value) => String(value).slice(0, 10),
}

const payment = {
  id: 1998,
  receipt_number: 'OR-2026-001757',
  paid_at: '2026-11-11T11:27:49Z',
  status: 'Completed',
  homeowner_name: 'Example Homeowner',
  block_name: 'MOCK500 Block 09',
  lot_number: 7,
  charge_type: 'Balance Payment',
  coverage_period: 'Balance payment',
  payment_method: 'Cash',
  previous_balance: 755.95,
  amount_paid: 655.95,
  remaining_balance: 100,
  manual_discount: { discount_amount: 100, cash_received: 655.95, gross_amount: 755.95 },
  receipt_breakdown: {
    returned_change: { cash_tendered: 700, change_amount: 44.05, gross_before_discount: 755.95, discount_amount: 100 },
    manual_cash_discount: { cash_tendered: 700, change_returned: 44.05, cash_received: 655.95, discount_amount: 100, advance_credit: 0 },
  },
}

describe('manual full-debt discount with returned change', () => {
  it('shows settled balance for the raw saved payment snapshot', () => {
    const receipt = buildReceiptModel('payment', payment, organization)
    const rows = Object.fromEntries(receipt.summary.map(({ label, value }) => [label, value]))
    expect(rows['Remaining balance']).toBe('PHP 0.00')
    expect(rows['Amount paid']).toBe('PHP 655.95')
    expect(rows['Less: Discount']).toBe('− PHP 100.00')
    expect(rows['Cash tendered']).toBe('PHP 700.00')
    expect(rows['Change returned']).toBe('PHP 44.05')
    expect(receipt.preprinted.totalSales).toBe('755.95')
    expect(receipt.preprinted.discount).toBe('100.00')
    expect(receipt.preprinted.totalPaid).toBe('655.95')
  })

  it('does not subtract the discount twice when PaymentsPage already adjusted it', () => {
    const receipt = buildReceiptModel('payment', { ...payment, remaining_balance: 0 }, organization)
    expect(receipt.summary.find(({ label }) => label === 'Remaining balance').value).toBe('PHP 0.00')
  })
})
