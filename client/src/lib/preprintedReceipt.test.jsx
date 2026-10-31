import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildPreprintedFields, normalizePaperNumber, preprintedLayoutError, receiptPaperKey, wrapReceiptText } from './preprintedReceipt'
import { buildReceiptModel } from './receiptModel'
import { receiptPrintHtml, printReceipt } from './printReceipt'
import PreprintedReceipt from '../components/PreprintedReceipt'

const organization = { associationName: 'Village Association', address: 'Village address', formatMoney: (v) => String(v), formatDate: (v) => String(v) }
const row = { id: 1, receipt_number: 'OR-2026-000010', homeowner_name: 'Lily', block_name: 'Block 3', lot_number: 12, amount_paid: '11000.00', amount: '12000.00', paid_at: '2026-10-31T20:00:00Z', coverage_period: 'Association dues - 12 months ahead', recorded_by_name: 'Secretary', status: 'Completed', receipt_breakdown: { annual_advance_discount: { months_covered: 12, gross_amount: '12000.00', discount_amount: '1000.00' } } }
const model = () => buildReceiptModel('payment', row, organization)

describe('preprinted invoice output', () => {
  it('uses saved annual amounts exactly and the Philippine payment date', () => {
    expect(buildPreprintedFields('payment', row)).toMatchObject({ name: 'Lily', lot: 'Block 3, Lot 12', date: '11/01/2026', quantity: '12', unitPrice: '1,000.00', lineAmount: '12,000.00', discount: '1,000.00', totalPaid: '11,000.00' })
  })
  it('does not assume a discount or month count when older data does not prove it', () => {
    const f = buildPreprintedFields('payment', { ...row, receipt_breakdown: null, amount_paid: '2400.01' })
    expect(f).toMatchObject({ quantity: '1', unitPrice: '2,400.01', lineAmount: '2,400.01', discount: '', totalPaid: '2,400.01' })
  })
  it('handles saved service quantity and partial collections without pretending the full bill was paid', () => {
    expect(buildPreprintedFields('service', { amount_due: '2400', amount_paid: '2400', quantity: 2 })).toMatchObject({ quantity: '2', unitPrice: '1,200.00' })
    expect(buildPreprintedFields('service', { amount_due: '2400', amount_paid: '500', quantity: 2, service_name: 'Hall' })).toMatchObject({ quantity: '1', unitPrice: '500.00', totalSales: '500.00', totalPaid: '500.00', description: 'Part payment - Hall' })
  })
  it('preserves decimal service quantities using exact integer arithmetic', () => {
    expect(buildPreprintedFields('service', { amount_due: '1200', amount_paid: '1200', quantity: '1.50' })).toMatchObject({ quantity: '1.5', unitPrice: '800.00' })
  })
  it('does not invent an exact unit price when division leaves fractions of a centavo', () => {
    expect(buildPreprintedFields('service', { amount_due: '1000', amount_paid: '1000', quantity: 3 }).unitPrice).toBe('')
  })
  it('keeps large decimal amounts exact', () => {
    expect(buildPreprintedFields('payment', { amount_paid: '9999999999.99' }).totalPaid).toBe('9,999,999,999.99')
  })
  it('preserves typed paper zeroes, rejects invalid numbers and maps each receipt type separately', () => {
    expect(normalizePaperNumber(' 003464 ')).toBe('003464')
    for (const number of ['', '000', '-3464', 'A3464', '3 464']) expect(() => normalizePaperNumber(number)).toThrow()
    expect(receiptPaperKey(model())).toEqual({ payment_id: 1 })
    expect(receiptPaperKey({ kind: 'service', sourceId: 'saved-uuid' })).toEqual({ service_transaction_id: 'saved-uuid' })
  })
  it('shows the guide on screen but sends no guide, red number, table lines or association header to print', () => {
    const m = model()
    const preview = renderToStaticMarkup(<PreprintedReceipt model={m} paperNumber="3464" />)
    expect(preview).toContain('SOLD TO:')
    expect(preview).toContain('No. 3464')
    const html = receiptPrintHtml(m, { paperNumber: '3464', alignment: { x: 1, y: -1 } })
    const body = html.split('<body>')[1]
    expect(html).toContain('@page { size: 139.7mm 215.9mm; margin: 0; }')
    expect(body).toContain('Block 3, Lot 12')
    expect(body).not.toContain('paper-guide')
    expect(body).not.toContain('SOLD TO:')
    expect(body).not.toContain('Village Association')
    expect(body).not.toContain('3464')
    expect(body).not.toContain('<table')
  })
  it('retains cancelled status on printed historical receipts', () => {
    expect(receiptPrintHtml({ ...model(), voided: true }, { paperNumber: '3464' })).toContain('CANCELLED')
  })
  it('blocks overflow rather than cutting saved descriptions or printing a second invoice sheet', () => {
    const f = { ...model().preprinted, description: 'Long saved description '.repeat(40) }
    expect(preprintedLayoutError(f)).toContain('too long')
    expect(() => receiptPrintHtml({ ...model(), preprinted: f }, { paperNumber: '3464' })).toThrow('too long')
    expect(wrapReceiptText('x'.repeat(80)).every((line) => line.length <= 36)).toBe(true)
  })
  it('does not open printing without a paper number', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    const error = vi.fn()
    try { printReceipt(model(), error) } finally { vi.unstubAllGlobals() }
    expect(open).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
  })
})
