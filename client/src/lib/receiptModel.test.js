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

  it('shows a settled partial receipt as settled once the balance was collected later', () => {
    const row = { receipt_number: 'SR-1', paid_at: '2026-10-05T01:00:00Z', amount_due: 500, amount_paid: 499.96, payment_status: 'partial', service_name: 'Basketball Court' }
    const open = buildReceiptModel('service', row, organization)
    expect(open.statusLabel).toBe('Partial payment')
    expect(open.summary.find((s) => s.label === 'Balance remaining').value).toBe('PHP 0.04')

    const settled = buildReceiptModel('service', row, organization, { settledAmount: 0.04 })
    expect(settled.statusLabel).toBe('Balance settled')
    expect(settled.summary.find((s) => s.label === 'Balance paid later').value).toBe('PHP 0.04')
    expect(settled.summary.find((s) => s.label === 'Balance remaining').value).toBe('PHP 0.00')
  })

  it('keeps showing the remainder when the later payments do not cover the balance', () => {
    const row = { receipt_number: 'SR-1', paid_at: '2026-10-05T01:00:00Z', amount_due: 1200, amount_paid: 300, payment_status: 'partial', service_name: 'Spa' }
    const m = buildReceiptModel('service', row, organization, { settledAmount: 500 })
    expect(m.statusLabel).toBe('Partial payment')
    expect(m.summary.find((s) => s.label === 'Balance remaining').value).toBe('PHP 400.00')
  })

  it('flags a voided service receipt', () => {
    const m = buildReceiptModel('service', { receipt_number: 'SR-2', paid_at: '2026-10-05T01:00:00Z', amount_paid: 50.04, payment_status: 'voided', service_name: 'Basketball Court' }, organization)
    expect(m.voided).toBe(true)
  })
})

describe('buildReceiptModel with a late-penalty breakdown', () => {
  const base = {
    receipt_number: 'OR-2026-000030', paid_at: '2026-10-25T02:00:00Z', status: 'Completed',
    homeowner_name: 'Lester Alcantara', block_name: 'Block A', lot_number: '12',
    coverage_period: 'Balance payment', payment_method: 'GCash', reference_number: 'GC-123',
    previous_balance: 87200, amount_paid: 87200, remaining_balance: 0, note: 'Paid in full',
    receipt_breakdown: {
      entered_balance: 80000, penalties_count: 6, penalties_rated_count: 6, penalties_posted_total: 7200,
      penalties_outstanding: 7200, rate_min: 0.015, rate_max: 0.015, unpaid_dues: 0, total_due: 87200,
      entry_lines: [{ category: 'Association Dues', as_of: '2020-05-25', description: 'Balance from March 2017 up to April 2025', original: 80000, unpaid: 80000 }],
      penalty_lines: [],
    },
  }

  it('prints the balance, penalties, total dues, method, reference and note', () => {
    const m = buildReceiptModel('payment', base, organization)
    const rows = Object.fromEntries(m.summary.map((r) => [r.label, r.value]))
    expect(rows['Balance']).toBe('PHP 80000.00')
    expect(rows['Late penalties (6 × 1.5%)']).toBe('PHP 7200.00')
    expect(rows['Total dues']).toBe('PHP 87200.00')
    expect(rows['Amount paid']).toBe('PHP 87200.00')
    expect(rows['Remaining balance']).toBe('PHP 0.00')
    expect(m.details.find((d) => d.label === 'Payment method').value).toBe('GCash')
    expect(m.details.find((d) => d.label === 'Reference no.').value).toBe('GC-123')
    expect(m.notes.map((n) => n.label)).toEqual(['Balance', 'Note'])
    expect(m.notes[0].text).toContain('Balance from March 2017 up to April 2025')
  })

  it('keeps the plain layout when there is no entered balance or penalty', () => {
    const m = buildReceiptModel('payment', { ...base, receipt_breakdown: { entered_balance: 0, penalties_count: 0, unpaid_dues: 3000 } }, organization)
    expect(m.summary.map((r) => r.label)).toEqual(['Previous balance', 'Amount paid', 'Remaining balance'])
  })

  it('lists each year rate when the penalty rates differ', () => {
    const rb = { ...base.receipt_breakdown, penalties_count: 2, penalties_rated_count: 2, penalties_outstanding: 2000, penalties_posted_total: 2000, rate_min: 0.015, rate_max: 0.025,
      penalty_lines: [{ no: 1, date: '2025-05-25', rate: 0.015, amount: 750 }, { no: 2, date: '2026-05-25', rate: 0.025, amount: 1250 }] }
    const m = buildReceiptModel('payment', { ...base, receipt_breakdown: rb }, organization)
    expect(m.summary.some((r) => r.label === 'Late penalties (2)')).toBe(true)
    expect(m.notes.find((n) => n.label === 'Penalty rates').text).toContain('1.5%')
    expect(m.notes.find((n) => n.label === 'Penalty rates').text).toContain('2.5%')
  })
})