import { describe, expect, it, vi } from 'vitest'
import { loadPaymentReceipt } from './paymentReceipt'
import { buildReceiptModel } from './receiptModel'

const payment = { id: 17, amount_paid: '1000.00', previous_balance: '1500.00', remaining_balance: '500.00' }
const discount = { payment_id: 17, discount_amount: '500.00', gross_amount: '1500.00', cash_received: '1000.00' }

function client(result) {
  const eq = vi.fn(() => ({ maybeSingle: async () => result }))
  return { from: vi.fn(() => ({ select: () => ({ eq }) })), eq }
}

describe('shared regular receipt lookup', () => {
  it('includes the journaled discount and shows the exact post-discount balance', async () => {
    const db = client({ data: discount, error: null })
    const row = await loadPaymentReceipt(db, payment)
    const organization = { formatMoney: value => value.toFixed(2), formatDate: String }
    const summary = buildReceiptModel('payment', row, organization).summary
    expect(db.eq).toHaveBeenCalledWith('payment_id', payment.id)
    expect(summary).toContainEqual({ label: 'Less: Discount', value: '− 500.00' })
    expect(summary).toContainEqual({ label: 'Remaining balance', value: '0.00' })
    expect(payment.remaining_balance).toBe('500.00')
  })

  it('preserves a regular receipt and rejects failed or inconsistent journal reads', async () => {
    expect(await loadPaymentReceipt(client({ data: null, error: null }), payment)).toBe(payment)
    await expect(loadPaymentReceipt(client({ error: Error('offline') }), payment)).rejects.toThrow('offline')
    await expect(loadPaymentReceipt(client({ data: { ...discount, cash_received: '999.99' } }), payment))
      .rejects.toThrow(/does not match/)
  })
})
