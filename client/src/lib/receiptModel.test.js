import { describe, expect, it } from 'vitest'
import { amountInWords, buildReceiptModel } from './receiptModel'

const organization = {
  associationName: 'PHILAM Village Homeowners Association',
  address: 'Cagayan de Oro City, Philippines',
  contactPhone: '',
  contactEmail: '',
  formatMoney: (v) => `PHP ${Number(v).toFixed(2)}`,
  formatDate: (v, o) => `D(${String(v).slice(0, 10)}${o?.withTime ? ' T' : ''})`,
}

describe('amountInWords', () => {
  it('spells out pesos and centavos', () => {
    expect(amountInWords(5000)).toBe('Five Thousand Pesos Only')
    expect(amountInWords(1)).toBe('One Peso Only')
    expect(amountInWords(50.04)).toBe('Fifty Pesos and 04/100 Only')
    expect(amountInWords(4999.98)).toBe('Four Thousand Nine Hundred Ninety-Nine Pesos and 98/100 Only')
    expect(amountInWords(1600)).toBe('One Thousand Six Hundred Pesos Only')
    expect(amountInWords(0.5)).toBe('Zero Pesos and 50/100 Only')
    expect(amountInWords(1000000)).toBe('One Million Pesos Only')
    expect(amountInWords(1001001)).toBe('One Million One Thousand One Pesos Only')
    expect(amountInWords(19911.98)).toBe('Nineteen Thousand Nine Hundred Eleven Pesos and 98/100 Only')
  })

  it('does not drift on floating-point amounts', () => {
    expect(amountInWords(0.1 + 0.2)).toBe('Zero Pesos and 30/100 Only')
  })
})

describe('buildReceiptModel', () => {
  const payment = {
    receipt_number: 'OR-2026-000029', paid_at: '2026-10-03T02:48:45Z', status: 'Completed',
    homeowner_name: 'Juan Dela Cruz', block_name: 'Block 3', lot_number: '12',
    coverage_period: 'Advance Payment — October 2026', payment_method: 'Cash',
    previous_balance: 0, amount_paid: 1600, remaining_balance: -1599.98, recorded_by_name: 'Philam Treasurer',
  }

  it('shows advance credit and a Lot prefix for a payment', () => {
    const m = buildReceiptModel('payment', payment, organization)
    expect(m.voided).toBe(false)
    expect(m.details.find((d) => d.label === 'Property').value).toBe('Block 3, Lot 12')
    expect(m.summary.map((s) => s.label)).toEqual(['Previous balance', 'Amount paid', 'Advance credit'])
    expect(m.summary[2].value).toBe('PHP 1599.98')
    expect(m.amountInWords).toBe('One Thousand Six Hundred Pesos Only')
  })

  it('marks a voided payment and keeps the reason', () => {
    const m = buildReceiptModel('payment', { ...payment, status: 'Voided', void_reason: 'Wrong homeowner' }, organization)
    expect(m.voided).toBe(true)
    expect(m.voidReason).toBe('Wrong homeowner')
    expect(m.statusLabel).toBe('Voided')
  })

  it('handles a partial service payment', () => {
    const m = buildReceiptModel('service', {
      receipt_number: 'SR-1', paid_at: '2026-10-05T01:00:00Z', customer_name: 'Ana', block_name: 'Block 1',
      lot_number: 'Lot 4', service_name: 'Function Hall', service_date: '2026-10-10', quantity: 1,
      amount_due: 3000, amount_paid: 1500, payment_status: 'partial', payment_method: 'Cash',
    }, organization)
    expect(m.statusLabel).toBe('Partial payment')
    expect(m.summary.map((s) => s.label)).toEqual(['Amount due', 'Amount paid', 'Balance remaining'])
    expect(m.summary[2].value).toBe('PHP 1500.00')
    expect(m.details.find((d) => d.label === 'Property').value).toBe('Block 1, Lot 4')
  })

  it('flags a voided service receipt', () => {
    const m = buildReceiptModel('service', { receipt_number: 'SR-2', paid_at: '2026-10-05T01:00:00Z', amount_paid: 50.04, payment_status: 'voided', service_name: 'Basketball Court' }, organization)
    expect(m.voided).toBe(true)
  })
})
