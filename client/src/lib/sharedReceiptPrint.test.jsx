import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReceiptModel } from './receiptModel'
import PreprintedReceipt from '../components/PreprintedReceipt'
import ReceiptPrintSetup from '../components/ReceiptPrintSetup'
const fixture = vi.hoisted(() => ({ single: vi.fn() }))
vi.mock('./supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ single: fixture.single }) }) }) } }))
import { receiptPrintHtml, printReceipt } from './printReceipt'
const organization = { associationName: 'Fixture HOA', address: 'Fixture address', formatMoney: String, formatDate: String }
function model(kind, staff) {
  const common = { id: 1, receipt_number: `${kind}-${staff}`, homeowner_name: 'Fixture owner', customer_name: 'Fixture customer', block_name: 'Block 1', lot_number: 2, paid_at: '2026-11-01T04:00:00Z', amount_paid: '100', recorded_by_name: staff }
  return buildReceiptModel(kind, kind === 'service' ? { ...common, service_name: 'Hall', amount_due: 100, quantity: 1, payment_status: 'paid' } : { ...common, amount: 100, charge_type: 'Balance Payment', status: 'Completed' }, organization)
}
function popup() {
  const child = { document: { write: vi.fn(), open: vi.fn(), close: vi.fn() }, close: vi.fn(), addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn(), closed: false }
  vi.stubGlobal('window', { open: vi.fn(() => child) })
  return child
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('all receipts use the shared calibration', () => {
  it.each(['Admin', 'Secretary', 'Treasurer'].flatMap((staff) => ['payment', 'service'].map((kind) => [staff, kind])))('prints %s / %s with the same saved setting', (staff, kind) => {
    const receipt = model(kind, staff), alignment = { x: 1.25, y: -0.5 }
    expect(receiptPrintHtml(receipt, { alignment })).toContain('--paper-offset-x:1.25mm;--paper-offset-y:-0.5mm')
    expect(renderToStaticMarkup(<PreprintedReceipt model={receipt} alignment={alignment} />)).toContain('--paper-offset-x:1.25mm;--paper-offset-y:-0.5mm')
  })
  it('does not silently print with zero or legacy browser offsets when alignment is missing', () => {
    expect(() => receiptPrintHtml(model('payment', 'Admin'))).toThrow('Load the shared printer alignment')
  })
  it('checks the latest database value and ignores caller/browser offsets', async () => {
    const child = popup(), error = vi.fn()
    fixture.single.mockResolvedValue({ data: { x_mm: 1.25, y_mm: -0.5, revision: 3 }, error: null })
    await printReceipt(model('payment', 'Admin'), error, { alignment: { x: 5, y: 5 }, revision: 3 })
    expect(error).not.toHaveBeenCalled()
    expect(child.document.write.mock.calls.at(-1)[0]).toContain('--paper-offset-x:1.25mm;--paper-offset-y:-0.5mm')
    expect(child.document.open.mock.invocationCallOrder[0]).toBeLessThan(child.addEventListener.mock.invocationCallOrder[0])
  })
  it('blocks a stale preview when another account saves newer calibration', async () => {
    const child = popup(), error = vi.fn()
    fixture.single.mockResolvedValue({ data: { x_mm: 1, y_mm: 0, revision: 4 }, error: null })
    await printReceipt(model('service', 'Secretary'), error, { revision: 3 })
    expect(child.close).toHaveBeenCalledOnce()
    expect(child.addEventListener).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('alignment changed'))
  })
  it('closes the print window and reports a load failure without printing defaults', async () => {
    const child = popup(), error = vi.fn()
    fixture.single.mockResolvedValue({ data: null, error: { message: 'Offline' } })
    await printReceipt(model('payment', 'Treasurer'), error)
    expect(child.close).toHaveBeenCalledOnce(); expect(child.addEventListener).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Offline'))
  })
  it('provides editable shared controls and an explicit Save action', () => {
    const html = renderToStaticMarkup(<ReceiptPrintSetup model={model('payment', 'Admin')} onReady={() => {}} />)
    expect(html).toContain('Save alignment for all receipts')
    expect(html).toContain('Reload saved alignment')
    expect(html).not.toContain('readonly=')
    expect(html).toContain('Loading shared printer alignment')
  })
})
