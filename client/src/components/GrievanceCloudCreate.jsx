import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { saveNewGrievanceToCloud, buildNewGrievanceDetails } from '../lib/grievanceCloud'
import DateField, { todayKey } from './DateField'

const CATEGORIES = ['Noise', 'Parking', 'Pets', 'Maintenance', 'Neighbor dispute',
  'Dues or payment dispute', 'Rule violation', 'Officer conduct', 'Other']

const EMPTY = {
  title: '', category: 'Noise', filedBy: '', concerns: '', location: '',
  description: '', requestedAction: '', handler: '', incidentDate: '', followUp: '',
}

function Field({ label, wide = false, required = false, children }) {
  return (
    <label className={'gc-field' + (wide ? ' gc-field--wide' : '')}>
      <span>{label}{required && <span aria-hidden="true"> *</span>}</span>
      {children}
    </label>
  )
}

function DetailCard({ rows, children }) {
  return (
    <div className="gc-detail-card">
      {children}
      <dl className="gc-detail-list">
        {rows.map(([label, value, optional = false]) => {
          const isMissing = optional && !String(value ?? '').trim()
          return (
            <div className="gc-detail-row" key={label}>
              <dt>{label}</dt>
              <dd className={isMissing ? 'gc-not-provided' : undefined}>
                {isMissing ? 'Not provided' : value}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}

function formatManilaDate(value) {
  const date = new Date(value || Date.now())
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric',
  }).format(date)
}

export default function GrievanceCloudCreate({ onSaved, onClose }) {
  const [draft, setDraft] = useState({ ...EMPTY })
  const [note, setNote] = useState('')
  const [stage, setStage] = useState('form')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedCase, setSavedCase] = useState(null)
  const [copyLabel, setCopyLabel] = useState('Copy')
  const pendingId = useRef(null)
  const savingRef = useRef(false)
  const successRef = useRef(null)
  const copyTimerRef = useRef(null)

  useEffect(() => {
    if (stage === 'success') successRef.current?.focus()
  }, [stage])

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])

  async function copyReference() {
    if (!savedCase?.reference) return
    try {
      await navigator.clipboard.writeText(savedCase.reference)
      setCopyLabel('Copied')
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopyLabel('Copy'), 1800)
    } catch {
      setCopyLabel('Copy failed')
      window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopyLabel('Copy'), 1800)
    }
  }

  function update(field, value) {
    setDraft(current => ({ ...current, [field]: value }))
    setError('')
  }

  function review(event) {
    event.preventDefault()
    if (savingRef.current) return
    try {
      buildNewGrievanceDetails(draft, note)
      setError('')
      setStage('review')
    } catch (failure) {
      setError(failure?.message || 'Please check the required fields.')
    }
  }

  async function confirmSave() {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    if (!pendingId.current) pendingId.current = crypto.randomUUID()
    const requestId = pendingId.current
    try {
      const record = await saveNewGrievanceToCloud(supabase, draft, note, requestId)
      const confirmation = {
        reference: record.case_number != null ? 'GR-' + record.case_number : String(record.id),
        title: record.title || draft.title.trim(),
        category: record.category || draft.category,
        filedBy: record.complainant || draft.filedBy.trim(),
        dateSaved: formatManilaDate(record.filed_at || record.created_at),
      }
      pendingId.current = null
      setSavedCase(confirmation)
      setStage('success')
      if (onSaved) onSaved(record)
    } catch (failure) {
      setError(
        (failure?.message || 'We could not confirm the save.') +
        ' Your entries are still here. Check the shared-case list before retrying.'
      )
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function recordAnother() {
    if (savingRef.current) return
    setDraft({ ...EMPTY })
    setNote('')
    setError('')
    setSavedCase(null)
    setCopyLabel('Copy')
    pendingId.current = null
    setStage('form')
  }

  return (
    <div className="gc-modal-content">
      <header className="gc-header">
        <div className="gc-header-copy">
          <h2 id="gc-title">{stage === 'success' ? 'Case recorded' :
            stage === 'review' ? 'Review grievance' : 'Record a grievance'}</h2>
          {stage !== 'success' && (
            <p>{stage === 'review' ? 'Check these details before saving.' :
              'Complete the details below. Required fields are marked *.'}</p>
          )}
        </div>
        <button type="button" className="gc-icon-close" aria-label="Close"
          onClick={onClose} disabled={saving}>×</button>
      </header>

      <div className="gc-body">
        {stage === 'success' ? (
          <section className="gc-success" role="status" aria-live="polite">
            <span className="gc-success-icon" aria-hidden="true">✓</span>
            <h3 ref={successRef} tabIndex={-1}>Grievance recorded</h3>
            <p>The case has been saved to the shared database and is now visible to the committee.</p>
            <DetailCard rows={[
              ['Title', savedCase?.title],
              ['Category', savedCase?.category],
              ['Person filing', savedCase?.filedBy],
              ['Date saved (Manila)', savedCase?.dateSaved],
            ]}>
              <div className="gc-reference-row">
                <span className="gc-reference-label">Reference ID</span>
                <div className="gc-reference-actions">
                  <span className="gc-reference-badge">{savedCase?.reference}</span>
                  <button type="button" className="gc-copy-button" onClick={copyReference}
                    aria-label={copyLabel === 'Copied' ? 'Reference ID copied' : 'Copy reference ID'}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="8" y="8" width="12" height="12" rx="2" />
                      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                    </svg>
                    {copyLabel}
                  </button>
                </div>
              </div>
            </DetailCard>
          </section>
        ) : stage === 'review' ? (
          <section aria-label="Review grievance before saving">
            <div className="gc-review-notice" role="note">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />
              </svg>
              <span>Nothing has been saved yet. Confirm to submit this case.</span>
            </div>
            <DetailCard rows={[
              ['Title', draft.title],
              ['Category', draft.category],
              ['Person filing', draft.filedBy],
              ['Person concerned', draft.concerns],
              ['Location', draft.location],
              ['Description', draft.description],
              ['Requested action', draft.requestedAction, true],
              ['Filing note', note],
            ]} />
          </section>        ) : (
          <form id="gc-entry-form" className="gc-form" onSubmit={review}>
            <div className="gc-grid">
              <Field label="Complaint title" required><input required maxLength={160}
                value={draft.title} onChange={e => update('title', e.target.value)} /></Field>
              <Field label="Category" required><select required value={draft.category}
                onChange={e => update('category', e.target.value)}>
                {CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}
              </select></Field>
              <Field label="Person filing" required><input required maxLength={200}
                value={draft.filedBy} onChange={e => update('filedBy', e.target.value)} /></Field>
              <Field label="Person or group concerned" required><input required maxLength={200}
                value={draft.concerns} onChange={e => update('concerns', e.target.value)} /></Field>
              <Field label="Location" required><input required maxLength={300}
                value={draft.location} onChange={e => update('location', e.target.value)} /></Field>
              <Field label="Assigned person or committee"><input maxLength={200}
                value={draft.handler} onChange={e => update('handler', e.target.value)} /></Field>
              <Field label="Incident date"><DateField ariaLabel="Incident date" max={todayKey()} value={draft.incidentDate}
                onChange={value => update('incidentDate', value)} /></Field>
              <Field label="Next follow-up date"><DateField ariaLabel="Next follow-up date" value={draft.followUp}
                onChange={value => update('followUp', value)} /></Field>
              <Field label="Description" required wide><textarea required rows={3} maxLength={6000}
                value={draft.description} onChange={e => update('description', e.target.value)} /></Field>
              <Field label="Requested action" wide><textarea rows={3} maxLength={3000}
                value={draft.requestedAction} onChange={e => update('requestedAction', e.target.value)} /></Field>
              <Field label="Filing note" required wide><textarea required rows={3} maxLength={4000}
                value={note} onChange={e => { setNote(e.target.value); setError('') }} /></Field>
            </div>
          </form>
        )}
        {error && <p className="gc-error" role="alert">{error}</p>}
      </div>

      <footer className="gc-footer">
        {stage === 'success' ? (
          <>
            <button type="button" className="gc-button gc-button-secondary"
              onClick={recordAnother}>Record another</button>
            <button type="button" className="gc-button gc-button-primary" onClick={onClose}>Done</button>
          </>
        ) : stage === 'review' ? (
          <>
            <button type="button" className="gc-button gc-button-secondary"
              onClick={() => { if (!saving) { setStage('form'); setError('') } }}
              disabled={saving}>Go Back</button>
            <button type="button" className="gc-button gc-button-primary"
              onClick={confirmSave} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm & Save'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="gc-button gc-button-secondary"
              onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="gc-entry-form" className="gc-button gc-button-primary"
              disabled={saving}>{saving ? 'Saving…' : 'Save new case to shared database'}</button>
          </>
        )}
      </footer>
    </div>
  )
}
