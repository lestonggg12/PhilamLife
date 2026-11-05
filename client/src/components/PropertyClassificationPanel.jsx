import React, { useEffect, useState } from 'react'
import './PropertyClassificationPanel.css'
import Select from './Select'
import DateField from './DateField'
import { useToast } from './Toast'
import Skeleton from './skeleton/Skeleton'
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
const formatHistoryDate = (value) => {
  if (!value) return 'Date unavailable'
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? value :
    new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(date)
}

function ClassificationPill({ value }) {
  return <span className={`phase1d-pill phase1d-pill--${value}`}>
    {classificationLabel(value)}
  </span>
}
export default function PropertyClassificationPanel({ propertyId, userRole, onChanged, onClose }) {
  const [current, setCurrent] = useState(null)
  const [history, setHistory] = useState([])
  const [next, setNext] = useState('')
  const [reason, setReason] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(() => manilaToday())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const toast = useToast()
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
      toast.success('Classification verified and saved with an audit event.')
      if (onChanged) onChanged()
      onClose?.()
    } catch (e) {
      setError(`${e.message} Refresh history before attempting again; do not retry blindly.`)
    } finally {
      setBusy(false)
    }
  }

  const validationHint = validateClassificationChange({
    current, next, reason, effectiveFrom,
  })
  const canSave = canEdit && !busy && !loading &&
    current != null && !validationHint

  return (
    <section className="phase1d-panel" aria-label="Classification details">
      <div className="phase1d-dialog-body">
        {loading ? (
          <div className="phase1d-loading" role="status" aria-label="Loading classification">
            <Skeleton width="38%" height="16px" />
            <Skeleton width="72%" height="42px" radius="10px" />
            <Skeleton width="100%" height="70px" radius="10px" />
            <Skeleton width="100%" height="110px" radius="10px" />
          </div>
        ) : (
          <>
            <section className="phase1d-section" aria-label="Current classification">
              <h3>Current classification</h3>
              <div className="phase1d-summary">
                {current != null && <ClassificationPill value={current} />}
                {current != null && <span className="phase1d-verified">✓ Verified</span>}
              </div>
              <p className="phase1d-info">
                <span aria-hidden="true">ⓘ</span>
                Classification is separate from Active/Moved account status.
                It does not change financial records.
              </p>
            </section>

            {error && <div className="phase1d-error" role="alert">{error}</div>}

            {canEdit && current != null && (
              <section className="phase1d-section" aria-labelledby="phase1d-change-title">
                <h3 id="phase1d-change-title">Change classification</h3>
                <form id="phase1d-classification-form" onSubmit={submit}>
                  <div className="phase1d-fields">
                    <div className="phase1d-field">
                      <span id="phase1d-next-label">New classification</span>
                      <Select value={next} onChange={setNext} disabled={busy}
                        ariaLabel="New property classification"
                        placeholder="Select classification"
                        options={CLASSIFICATIONS.filter((item) => item.value !== current)} />
                    </div>
                    <div className="phase1d-field">
                      <span>Effective date</span>
                      <DateField value={effectiveFrom} onChange={setEffectiveFrom}
                        min={manilaToday()} max={manilaToday()}
                        clearable={false} disabled={busy}
                        ariaLabel="Effective date, Manila today only" />
                      <small>Today (Manila) only</small>
                    </div>
                  </div>
                  <div className="phase1d-field">
                    <label htmlFor="phase1d-reason">Reason / verification notes</label>
                    <textarea id="phase1d-reason" required minLength={5}
                      maxLength={1000} rows={3} value={reason}
                      disabled={busy} aria-describedby="phase1d-reason-help"
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Describe how the classification was verified..." />
                    <div className="phase1d-field-meta" id="phase1d-reason-help">
                      <span>{reason.trim().length < 5
                        ? 'Enter at least 5 characters.' : 'Verification reason recorded in history.'}</span>
                      <span>{reason.length} / 1000</span>
                    </div>
                  </div>
                </form>
              </section>
            )}

            <section className="phase1d-section" aria-labelledby="phase1d-history-title">
              <div className="phase1d-section-heading">
                <h3 id="phase1d-history-title">Classification history</h3>
                <span className="phase1d-count">{history.length} records</span>
              </div>
              {history.length === 0 ? (
                <div className="phase1d-empty">
                  <span aria-hidden="true">◷</span>
                  <p>No verified changes recorded yet.</p>
                </div>
              ) : (
                <ol className="phase1d-history">
                  {history.map((item) => (
                    <li key={item.id}>
                      <time dateTime={item.effective_from}>{formatHistoryDate(item.effective_from)}</time>
                      <div className="phase1d-history-transition">
                        <ClassificationPill value={item.old_classification} />
                        <span aria-hidden="true">→</span>
                        <ClassificationPill value={item.new_classification} />
                      </div>
                      <p>{item.reason}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
      <footer className="phase1d-dialog-footer">
        <button type="button" className="phase1d-cancel" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {canEdit && (
          <div className="phase1d-save-wrap">
            {!canSave && !busy && !loading &&
              <span className="phase1d-save-hint">{validationHint}</span>}
            <button type="submit" form="phase1d-classification-form"
              className="phase1d-save" disabled={!canSave}>
              {busy ? 'Saving...' : 'Save classification'}
            </button>
          </div>
        )}
      </footer>
    </section>
  )
}