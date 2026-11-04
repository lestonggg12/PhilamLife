import { describe, expect, it } from 'vitest'
import {
  buildPreprintedFields,
  formatInvoiceQuantity,
  preprintedLayoutError,
} from './preprintedReceipt'

const service = (overrides = {}) => ({
  quantity: '4.3333',
  amount_due: '433.33',
  amount_paid: '433.33',
  service_name: 'Spa',
  customer_name: 'Test Homeowner',
  ...overrides,
})

describe('Preprinted invoice quantity precision', () => {
  it('displays exactly two decimal places', () => {
    expect(formatInvoiceQuantity('4.3333')).toBe('4.33')
    expect(formatInvoiceQuantity('4.3350')).toBe('4.34')
    expect(formatInvoiceQuantity('5')).toBe('5.00')
    expect(formatInvoiceQuantity('100.00')).toBe('100.00')
  })

  it('preserves the saved peso total', () => {
    const fields = buildPreprintedFields('service', service())
    expect(fields.quantity).toBe('4.33')
    expect(fields.lineAmount).toBe('433.33')
    expect(fields.totalPaid).toBe('433.33')
    expect(fields.unitPrice).toBe('')
    expect(preprintedLayoutError(fields)).toBe('')
  })

  it('also formats quantities on partial receipts', () => {
    const fields = buildPreprintedFields(
      'service',
      service({ amount_paid: '50.00' }),
    )
    expect(fields.quantity).toBe('4.33')
    expect(fields.totalPaid).toBe('50.00')
    expect(fields.unitPrice).toBe('')
  })

  it('keeps linked collection receipts as one payment', () => {
    const fields = buildPreprintedFields('service', service({
      balance_of: 'existing-receipt-id',
      quantity: '1',
      amount_due: '50.00',
      amount_paid: '50.00',
    }))
    expect(fields.quantity).toBe('1')
  })

  it('does not silently overflow the physical quantity box', () => {
    const fields = buildPreprintedFields('service', service({
      quantity: '1000.00',
    }))
    expect(preprintedLayoutError(fields)).toMatch(/quantity/i)
  })
})
