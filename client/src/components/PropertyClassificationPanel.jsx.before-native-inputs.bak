import React, { useEffect, useState } from 'react'
import './PropertyClassificationPanel.css'
import { supabase } from '../lib/supabaseClient'
import {
  CLASSIFICATIONS,
  classificationLabel,
  canClassifyProperty,
  manilaToday,
  validateClassificationChange,
} from '../lib/propertyClassification'

// Safe to mount ONLY after the reviewed Phase 1 schema exists in an isolated
// environment. A production enablement requires penalty-engine gating (Phase 2).
export default function PropertyClassificationPanel({ propertyId, userRole, onChanged }) {
  const [current, setCurrent] = useState(null)
  const [history, setHistory] = useState([])
  const [next, setNext] = useState('')
  const [reason, setReason] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(() => manilaToday())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canEdit = canClassifyProperty(userRole)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setCurrent(null)
    setHistory([])
    async function load() {
      const [p, h] = await Promise.all([
        supabase.from('properties').select('property_classification').eq('id', propertyId).single(),
        supabase.from('property_classification_history')
          .select('id,old_classification,new_classification,effective_from,recorded_at,reason')
          .eq('property_id', propertyId).order('effective_from', { ascending: false }),
      ])
      if (cancelled) return
      if (p.error || h.error) {
        setError(`Classification data unavailable: ${(p.error || h.error).message}`)
      } else {
        setCurrent(p.data.property_classification)
        setHistory(h.data || [])
      }
      setLoading(false)
    }
    if (propertyId != null) load()
    return () => { cancelled = true }
  }, [propertyId])

  async function submit(event) {
    event.preventDefault()
    if (!canEdit || busy || loading || current == null) return
    const validation = validateClassificationChange({ current, next, reason, effectiveFrom })
    if (validation) { setError(validation); return }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: rpcError } = await supabase.rpc('classify_property', {
        p_property_id: propertyId,
        p_new_classification: next,
        p_reason: reason.trim(),
        p_effective_from: effectiveFrom,
      })
      if (rpcError) throw rpcError
      // Re-read authority from server; never assume successful write from client state.
      const [p, h] = await Promise.all([
        supabase.from('properties').select('property_classification').eq('id', propertyId).single(),
        supabase.from('property_classification_history')
          .select('id,old_classification,new_classification,effective_from,recorded_at,reason')
          .eq('property_id', propertyId).order('effective_from', { ascending: false }),
      ])
      if (p.error || h.error) throw p.error || h.error
      if (p.data.property_classification !== next) throw new Error('Classification could not be verified; refresh before retrying.')
      setCurrent(p.data.property_classification)
      setHistory(h.data || [])
      setNext('')
      setReason('')
      setNotice('Classification verified and saved with an audit event.')
      if (onChanged) onChanged()
    } catch (e) {
      setError(`${e.message} Refresh history before attempting again; do not retry blindly.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Property classification" className="phase1d-card">
      <h3>Property classification</h3>
      {loading ? <p>Loading classification…</p> : null}
      {current != null ? <p>Verified status: <strong>{classificationLabel(current)}</strong></p> : null}
      <p>Classification is separate from Active/Moved account status. It does not change financial records.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {canEdit && current != null && !loading && (
        <form onSubmit={submit}>
          <label>New classification
            <select required value={next} disabled={busy} onChange={(e) => setNext(e.target.value)}>
              <option value="">Select classification</option>
              {CLASSIFICATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>Effective date (Manila today only)
            <input type="date" required value={effectiveFrom} disabled={busy}
              onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
          <label>Reason / verification notes
            <textarea required minLength={5} maxLength={1000} value={reason} disabled={busy}
              onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !next || next === current || !reason.trim()}>
            {busy ? 'Saving…' : 'Save classification'}
          </button>
        </form>
      )}
      <h4>Classification history</h4>
      {!loading && history.length === 0 ? <p>No verified changes recorded yet.</p> : null}
      <ul>
        {history.map((item) => <li key={item.id}>
          {item.effective_from}: {classificationLabel(item.old_classification)} → {classificationLabel(item.new_classification)} — {item.reason}
        </li>)}
      </ul>
    </section>
  )
}
