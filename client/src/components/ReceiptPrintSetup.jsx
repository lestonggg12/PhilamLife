import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { notifySuccess } from '../lib/actionFeedback'
import { alignmentValue, normalizePaperNumber, readPrintAlignment, receiptPaperKey } from '../lib/preprintedReceipt'

export default function ReceiptPrintSetup({ model, onReady }) {
  const [number, setNumber] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [alignment, setAlignment] = useState(readPrintAlignment)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    async function load() {
      try {
        const key = receiptPaperKey(model)
        const [column, value] = Object.entries(key)[0]
        const { data, error: readError } = await supabase.from('receipt_paper_numbers').select('invoice_number').eq(column, value).maybeSingle()
        if (cancelled) return
        if (readError) setError('Could not load the paper number. The print setup may need its database update. Ask the administrator to check it.')
        else { setSaved(data?.invoice_number || ''); setNumber(data?.invoice_number || '') }
      } catch { if (!cancelled) setError('Could not load the paper number. Please reopen the receipt and try again.') }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [model.kind, model.sourceId, reload])
  useEffect(() => {
    onReady({ key: `${model.kind}:${model.sourceId}`, paperNumber: saved, alignment, ready: !loading && !saving && Boolean(saved) && !error })
  }, [model.kind, model.sourceId, saved, alignment, loading, saving, error, onReady])
  async function saveNumber(event) {
    event.preventDefault()
    if (saving || saved || loading) return
    let invoice
    try { invoice = normalizePaperNumber(number) } catch (failure) { setError(failure.message); return }
    setSaving(true); setError('')
    try {
      const { data, error: saveError } = await supabase.from('receipt_paper_numbers')
        .insert({ ...receiptPaperKey(model), invoice_number: invoice }).select('invoice_number').single()
      if (saveError) {
        setError(saveError.code === '23505'
          ? 'This paper number or receipt is already assigned. Check the red number and reload the saved number before trying again.'
          : 'The invoice number could not be saved. Please try again or ask the administrator to check the print setup.')
      } else {
        setSaved(data.invoice_number); setNumber(data.invoice_number)
        notifySuccess(`Paper invoice ${data.invoice_number} linked to receipt ${model.receiptNumber}.`)
      }
    } catch { setError('The invoice number could not be saved. Check your connection and try again.') }
    finally { setSaving(false) }
  }
  function changeAlignment(axis, value) {
    const next = { ...alignment, [axis]: alignmentValue(value) }
    setAlignment(next)
    try { localStorage.setItem('philamlife-receipt-alignment-v1', JSON.stringify(next)) } catch { /* Printing can continue without local preferences. */ }
  }
  return <section className="receipt-print-setup" aria-label="Preprinted paper setup">
    <form onSubmit={saveNumber}>
      <label htmlFor="paper-invoice-number">Red invoice number on the paper</label>
      <div className="receipt-number-row">
        <input id="paper-invoice-number" inputMode="numeric" maxLength={20} value={number} placeholder="e.g. 3464"
          disabled={loading || saving || Boolean(saved)} onChange={(event) => { setNumber(event.target.value); setError('') }} />
        {!saved && <button type="submit" className="rcpt-btn rcpt-btn-secondary" disabled={loading || saving}>{saving ? 'Saving…' : 'Save number'}</button>}
        {saved && <strong>Saved</strong>}
      </div>
      <p>{loading ? 'Loading saved paper number…' : saved ? `System receipt: ${model.receiptNumber}. Load paper with this red number. Saved numbers are read-only here.` : 'Check the red number before saving. It will be linked to this receipt and will not be printed again.'}</p>
      {error && <p className="receipt-setup-error" role="alert">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>Reload saved number</button></p>}
    </form>
    <details className="receipt-alignment"><summary>Printer alignment</summary>
      <p>Use half-letter paper (139.7 × 215.9 mm), Actual size / 100%, and turn off browser headers and footers. Test on plain paper first.</p>
      <div className="receipt-alignment-row">
        <label>Move right (+) / left (−), mm<input type="number" step="0.5" min="-5" max="5" value={alignment.x} onChange={(event) => changeAlignment('x', event.target.value)} /></label>
        <label>Move down (+) / up (−), mm<input type="number" step="0.5" min="-5" max="5" value={alignment.y} onChange={(event) => changeAlignment('y', event.target.value)} /></label>
        <button type="button" className="rcpt-btn rcpt-btn-secondary" onClick={() => { setAlignment({ x: 0, y: 0 }); try { localStorage.removeItem('philamlife-receipt-alignment-v1') } catch {} }}>Reset</button>
      </div>
    </details>
  </section>
}
