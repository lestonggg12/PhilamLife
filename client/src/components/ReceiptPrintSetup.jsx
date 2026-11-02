import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { loadReceiptAlignment, receiptAlignmentOffsets, saveReceiptAlignment } from '../lib/receiptAlignment'
import Skeleton from './skeleton/Skeleton'

export default function ReceiptPrintSetup({ model, onReady }) {
  const [saved, setSaved] = useState(null)
  const [draft, setDraft] = useState({ x: '', y: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [changedElsewhere, setChangedElsewhere] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const request = useRef(0)
  const mounted = useRef(true)
  const current = useRef({})
  const dirty = !saved || draft.x !== String(saved.x) || draft.y !== String(saved.y)
  current.current = { saved, dirty, saving }

  function apply(value) {
    setSaved(value); setDraft({ x: String(value.x), y: String(value.y) })
    setChangedElsewhere(false); setError('')
  }
  async function reload(discardDraft = false) {
    if (current.current.saving) return
    const sequence = ++request.current
    if (discardDraft || !current.current.saved) setLoading(true)
    try {
      const value = await loadReceiptAlignment(supabase)
      if (!mounted.current || sequence !== request.current) return
      if (discardDraft || !current.current.dirty || !current.current.saved) {
        if (discardDraft || value.revision !== current.current.saved?.revision) apply(value)
        else setError('')
      } else if (value.revision !== current.current.saved.revision) {
        setChangedElsewhere(true)
        setError('Alignment changed in another session. Reload the saved alignment before printing or saving.')
      }
    } catch (failure) {
      if (mounted.current && sequence === request.current) setError(`Could not verify shared alignment: ${failure.message}`)
    } finally {
      if (mounted.current && sequence === request.current) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void reload()
    const refresh = () => { void reload() }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      mounted.current = false; request.current += 1
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [])
  useEffect(() => {
    let alignment = saved && { x: saved.x, y: saved.y }
    try { alignment = receiptAlignmentOffsets(draft) } catch { /* Keep the last saved preview while editing an incomplete number. */ }
    onReady({ key: `${model.kind}:${model.sourceId}`, alignment, revision: saved?.revision,
      ready: Boolean(saved) && !dirty && !loading && !saving && !error && !changedElsewhere })
  }, [model.kind, model.sourceId, saved, draft, dirty, loading, saving, error, changedElsewhere, onReady])

  function edit(axis, value) {
    current.current.dirty = true
    setDraft((previous) => ({ ...previous, [axis]: value })); setMessage('')
  }
  async function save(event) {
    event.preventDefault()
    if (!saved || saving || changedElsewhere) return
    current.current.saving = true; request.current += 1
    setSaving(true); setMessage(''); setError('')
    try {
      const value = await saveReceiptAlignment(supabase, draft, saved.revision)
      if (!mounted.current) return
      apply(value); setMessage('Alignment saved for all accounts and receipts.')
    } catch (failure) {
      if (mounted.current) {
        setError(failure.message)
        if (failure.code === '40001') setChangedElsewhere(true)
      }
    } finally {
      current.current.saving = false
      if (mounted.current) { setSaving(false); setLoading(false) }
    }
  }
  return <section className="receipt-print-setup" aria-label="Shared printer calibration">
    <details className="receipt-alignment"><summary>Printer alignment — shared</summary>
      <p>Save once to apply the same alignment to all accounts, browsers and receipts. Save changes before printing a calibration test.</p>
      <p>Use half-letter paper (139.7 × 215.9 mm), Actual size / 100%, and turn off browser headers and footers. Test on plain paper first.</p>
      <form onSubmit={save}>
        <div className="receipt-alignment-row">
          <label>Move right (+) / left (−), mm<input type="number" step="0.01" min="-5" max="5" value={draft.x} disabled={loading || saving || !saved} onChange={(event) => edit('x', event.target.value)} /></label>
          <label>Move down (+) / up (−), mm<input type="number" step="0.01" min="-5" max="5" value={draft.y} disabled={loading || saving || !saved} onChange={(event) => edit('y', event.target.value)} /></label>
          <button type="button" className="rcpt-btn rcpt-btn-secondary" disabled={loading || saving || !saved} onClick={() => { edit('x', '0'); edit('y', '0') }}>Reset to zero</button>
          <button type="submit" className="rcpt-btn rcpt-btn-primary" disabled={loading || saving || !saved || changedElsewhere || !dirty}>{saving ? 'Saving…' : 'Save alignment for all receipts'}</button>
          <button type="button" className="rcpt-btn rcpt-btn-secondary" disabled={saving} onClick={() => { void reload(true) }}>Reload saved alignment</button>
        </div>
      </form>
    </details>
      {loading && <div className="receipt-print-setup-skeleton" aria-busy="true" aria-label="Loading shared printer alignment"><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><span className="skeleton-region-status" role="status">Loading</span></div>}
      {dirty && saved && !saving && <p role="status">Unsaved alignment changes. Save them before printing.</p>}
      {error && <p className="receipt-setup-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
  </section>
}
