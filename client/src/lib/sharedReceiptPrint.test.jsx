import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { buildReceiptModel } from './receiptModel'
import PreprintedReceipt from '../components/PreprintedReceipt'
import ReceiptPrintSetup from '../components/ReceiptPrintSetup'
const fixture = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn().mockResolvedValue({ error: null }) }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc: fixture.rpc, from: () => ({ select: () => ({ eq: () => ({ single: fixture.single }) }) }) } }))
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
beforeEach(() => { fixture.rpc.mockReset().mockResolvedValue({ error: null }) })
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


describe('receipt print audit gate', () => {
  it.each(['payment','service'])('waits for the %s audit before releasing receipt content or print handlers', async (kind) => {
    let resolveAudit
    const child = popup(), error = vi.fn(), receipt = model(kind, 'Admin')
    fixture.single.mockResolvedValue({data:{x_mm:0,y_mm:0,revision:1},error:null})
    fixture.rpc.mockImplementationOnce(() => new Promise(resolve => { resolveAudit = resolve }))
    const pending = printReceipt(receipt,error)
    for(let i=0;i<10;i++) await Promise.resolve()
    expect(fixture.rpc).toHaveBeenCalledWith('record_receipt_activity',{p_action:'Receipt Print Requested',p_kind:kind,p_record_id:String(receipt.sourceId)})
    expect(child.document.open).not.toHaveBeenCalled()
    expect(child.addEventListener).not.toHaveBeenCalled()
    expect(child.print).not.toHaveBeenCalled()
    resolveAudit({error:null}); await pending
    expect(error).not.toHaveBeenCalled()
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
    expect(child.document.open).toHaveBeenCalledOnce()
    child.addEventListener.mock.calls[0][1]()
    expect(child.print).toHaveBeenCalledOnce()
  })
  it.each([{message:'Audit unavailable'},new Error('Offline')])('blocks printing when its audit cannot be saved: %s',async failure => {
    const child=popup(),error=vi.fn()
    fixture.single.mockResolvedValue({data:{x_mm:0,y_mm:0,revision:1},error:null})
    if(failure instanceof Error) fixture.rpc.mockRejectedValueOnce(failure)
    else fixture.rpc.mockResolvedValueOnce({error:failure})
    await printReceipt(model('payment','Admin'),error)
    expect(child.close).toHaveBeenCalledOnce()
    expect(child.document.open).not.toHaveBeenCalled()
    expect(child.addEventListener).not.toHaveBeenCalled()
    expect(child.print).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Audit unavailable|Offline/))
  })
  it('does not request an audit or open receipt content when the popup is blocked',async()=>{
    vi.stubGlobal('window',{open:()=>null})
    const error=vi.fn();await printReceipt(model('payment','Admin'),error)
    expect(fixture.rpc).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('pop-ups'))
  })
  it('does not print after the staff member closes the waiting popup',async()=>{
    let resolveAudit
    const child=popup()
    fixture.single.mockResolvedValue({data:{x_mm:0,y_mm:0,revision:1},error:null})
    fixture.rpc.mockImplementationOnce(()=>new Promise(resolve=>{resolveAudit=resolve}))
    const pending=printReceipt(model('payment','Admin'),vi.fn())
    for(let i=0;i<10;i++)await Promise.resolve()
    child.closed=true;resolveAudit({error:null});await pending
    expect(child.document.open).not.toHaveBeenCalled();expect(child.print).not.toHaveBeenCalled()
  })
})
