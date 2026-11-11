import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function ReceiptNoteAmendmentDialog({ payment, onClose, onSaved }) {
  const [note, setNote] = useState(payment.note || '')
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState([])
  const [historyError, setHistoryError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    supabase.from('receipt_note_amendments')
      .select('id, previous_note, new_note, reason, created_at, actor_id')
      .eq('payment_id', payment.id)
      .order('created_at', { ascending: false })
      .limit(25)
      .then(({ data, error: readError }) => {
        if (!live) return
        if (readError) setHistoryError('Amendment history could not be loaded.')
        else setHistory(data || [])
      })
    return () => { live = false }
  }, [payment.id])
  async function save(event) {
    event.preventDefault()
    if (busy) return
    if (reason.trim().length < 5 || note.trim() === (payment.note || '').trim()) {
      setError('Enter a reason of at least 5 characters and change the note.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error: writeError } = await supabase.rpc('amend_completed_receipt_note', {
        p_payment_id: payment.id,
        p_new_note: note.trim() || null,
        p_reason: reason.trim(),
      })
      if (writeError) throw writeError
      onSaved(note.trim() || null)
    } catch (failure) {
      setError(failure.message || 'The receipt note could not be amended.')
    } finally { setBusy(false) }
  }
  return (
    <div className="payments-overlay advance-overlay" onMouseDown={() => !busy && onClose()}>
      <form className="advance-dialog payment-detail" role="dialog" aria-modal="true"
        aria-labelledby="receipt-note-amend-title" onSubmit={save}
        onMouseDown={event => event.stopPropagation()}>
        <div className="void-head">
          <div>
            <h2 id="receipt-note-amend-title">Amend receipt note — {payment.receipt_number}</h2>
            <p>The previous note and reason will be kept in the audit history. Financial amounts will not change.</p>
          </div>
        </div>
        <label htmlFor="receipt-amended-note">Corrected note (250 characters maximum)</label>
        <textarea id="receipt-amended-note" rows={3} maxLength={250} value={note}
          onChange={event => setNote(event.target.value)} disabled={busy} />
        <label htmlFor="receipt-amend-reason">Correction reason (required)</label>
        <textarea id="receipt-amend-reason" rows={2} minLength={5} maxLength={500} required
          value={reason} onChange={event => setReason(event.target.value)} disabled={busy} />
        {error && <p role="alert">{error}</p>}
        <section aria-label="Previous receipt-note amendments">
          <h3>Correction history</h3>
          {historyError && <p role="alert">{historyError}</p>}
          {!historyError && history.length === 0 && <p>No earlier amendments.</p>}
          {history.map(entry => (
            <div key={entry.id}>
              <small>{new Date(entry.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</small>
              <p><strong>Previous:</strong> {entry.previous_note || '—'}</p>
              <p><strong>Corrected:</strong> {entry.new_note || '—'}</p>
              <p><strong>Reason:</strong> {entry.reason}</p>
            </div>
          ))}
        </section>
        <div className="payment-detail-actions">
          <button type="button" className="payments-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="payments-primary" disabled={busy || reason.trim().length < 5 || note.trim() === (payment.note || '').trim()}>
            {busy ? 'Saving…' : 'Save audited correction'}
          </button>
        </div>
      </form>
    </div>
  )
}
