import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './GrievanceCloudReview.css'

const CASE_FIELDS = [
  'id', 'case_number', 'title', 'category', 'status', 'complainant', 'respondent',
  'homeowner_name', 'block', 'lot_number', 'location', 'description',
  'requested_action', 'incident_date', 'assigned_handler', 'follow_up_date',
  'rule_reference', 'evidence_notes', 'outcome', 'decision_authority',
  'filed_at', 'updated_at', 'property_id', 'version',
].join(',')

function dateOnly(value) {
  if (!value) return 'Not provided'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return String(value)
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function manilaDateTime(value) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)
}

const STATUSES = [
  'Received', 'Under review', 'In mediation', 'Awaiting decision',
  'Awaiting action', 'Referred', 'Resolved', 'Dismissed', 'Withdrawn',
]
const CLOSED = ['Resolved', 'Dismissed', 'Withdrawn']

function editableFrom(record) {
  return {
    status: record.status,
    assigned_handler: record.assigned_handler || '',
    follow_up_date: record.follow_up_date || '',
    outcome: record.outcome || '',
    decision_authority: record.decision_authority || '',
    note: '',
  }
}

function updateDetails(record, changes) {
  return {
    title: record.title, category: record.category, status: changes.status,
    complainant: record.complainant, respondent: record.respondent,
    property_id: record.property_id, location: record.location,
    description: record.description, requested_action: record.requested_action,
    incident_date: record.incident_date, assigned_handler: changes.assigned_handler.trim(),
    follow_up_date: changes.follow_up_date || null,
    rule_reference: record.rule_reference, evidence_notes: record.evidence_notes,
    outcome: changes.outcome.trim(), decision_authority: changes.decision_authority.trim(),
  }
}

function validateUpdate(changes) {
  if (!STATUSES.includes(changes.status)) return 'Choose a valid status.'
  if (changes.assigned_handler.length > 200) return 'The assigned handler must be 200 characters or fewer.'
  if (changes.outcome.length > 4000) return 'The outcome must be 4000 characters or fewer.'
  if (changes.decision_authority.length > 300) return 'Decision authority must be 300 characters or fewer.'
  if (!changes.note.trim() || changes.note.trim().length > 4000) return 'Enter an update note (up to 4000 characters).'
  if (CLOSED.includes(changes.status) && !changes.outcome.trim()) return 'Record the outcome before closing the case.'
  if (['Resolved','Dismissed'].includes(changes.status) && !changes.decision_authority.trim()) {
    return 'Record who authorized the decision.'
  }
  return ''
}

function Details({ rows }) {
  return <dl className="gcr-details">
    {rows.map(([label, value]) => <div className="gcr-detail" key={label}>
      <dt>{label}</dt>
      <dd className={value === null || value === undefined || value === '' ? 'gcr-empty' : undefined}>
        {value === null || value === undefined || value === '' ? 'Not provided' : value}
      </dd>
    </div>)}
  </dl>
}

export default function GrievanceCloudReview({ caseId, onClose, onSaved }) {
  const [result, setResult] = useState({ state: 'loading', record: null, events: [], error: '' })
  const titleRef = useRef(null)
  const savingRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [changes, setChanges] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    let active = true
    setResult({ state: 'loading', record: null, events: [], error: '' })
    setEditing(false)
    setChanges(null)
    setSaveError('')
    setSaveNotice('')
    async function load() {
      try {
        const { data: record, error: caseError } = await supabase
          .from('grievance_cases').select(CASE_FIELDS).eq('id', caseId).single()
        if (caseError) throw caseError
        if (!record) throw new Error('This grievance could not be found.')
        const { data: events, error: eventError } = await supabase
          .from('grievance_events')
          .select('id,previous_status,status,note,recorded_at,recorded_by_name')
          .eq('case_id', caseId).order('recorded_at', { ascending: false })
        if (eventError) throw eventError
        if (active) setResult({ state: 'ready', record, events: events || [], error: '' })
      } catch (error) {
        if (active) setResult({ state: 'error', record: null, events: [], error: error?.message || 'Unable to load grievance details.' })
      }
    }
    void load()
    return () => { active = false }
  }, [caseId])

  async function saveUpdate() {
    if (savingRef.current || !result.record || !changes) return
    const validation = validateUpdate(changes)
    if (validation) { setSaveError(validation); return }
    savingRef.current = true
    setSaving(true)
    setSaveError('')
    setSaveNotice('')
    try {
      const current = result.record
      const { data, error } = await supabase.rpc('save_grievance', {
        p_case_id: current.id,
        p_expected_version: current.version,
        p_details: updateDetails(current, changes),
        p_note: changes.note.trim(),
      })
      if (error) throw error
      if (!data || data.id !== current.id || data.version !== current.version + 1) {
        throw new Error('The update could not be confirmed. Close and refresh the case before retrying.')
      }
      // Retrieve the new audit history before claiming the update is fully refreshed.
      const { data: history, error: historyError } = await supabase
        .from('grievance_events')
        .select('id,previous_status,status,note,recorded_at,recorded_by_name')
        .eq('case_id', caseId).order('recorded_at', { ascending: false })
      setResult(previous => ({
        ...previous, state: 'ready', record: data,
        events: historyError ? previous.events : (history || []),
      }))
      setEditing(false)
      setChanges(null)
      setSaveNotice(historyError ? 'Case saved. Refresh or reopen to load the latest history.' : 'Case updated and history refreshed.')
      if (onSaved) onSaved(data)
    } catch (failure) {
      setSaveError((failure?.message || 'Case update failed.') + ' Your entries are preserved. Check the case history before retrying.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const { state, record, events, error } = result
  return <div className="gc-modal-content gcr-modal">
    <header className="gc-header">
      <div className="gc-header-copy">
        <h2 ref={titleRef} tabIndex={-1}>Review shared grievance</h2>
        <p>{editing ? 'Update status, follow-up and resolution details' : 'Shared case details and audit history'}</p>
      </div>
      <button className="gc-icon-close" type="button" aria-label="Close" onClick={onClose} disabled={saving}>×</button>
    </header>
    <div className="gc-body gcr-body">
      {state === 'loading' && <p role="status" className="gcr-message">Loading case details and history…</p>}
      {state === 'error' && <p role="alert" className="gcr-error">{error}</p>}
      {saveNotice && <p className="gcr-notice" role="status">{saveNotice}</p>}
      {state === 'ready' && record && <>
        <div className="gcr-hero">
          <span className="gcr-ref">GR-{record.case_number}</span>
          <span className="gcr-status">{record.status}</span>
          <h3>{record.title}</h3>
          <p>{record.category}</p>
        </div>
        {editing && changes && <section className="gcr-section gcr-update-section" aria-label="Update shared grievance">
          <h4>Update case</h4>
          <p className="gcr-help">Changes are saved to the shared database with an audit entry. A note is required even for follow-up-only updates.</p>
          <div className="gcr-update-grid">
            <label>Status
              <select value={changes.status} disabled={saving} onChange={e => setChanges(v => ({ ...v, status: e.target.value }))}>
                {STATUSES.map(s => <option value={s} key={s}>{s}</option>)}
              </select>
            </label>
            <label>Assigned person or committee
              <input maxLength={200} disabled={saving} value={changes.assigned_handler} onChange={e => setChanges(v => ({ ...v, assigned_handler: e.target.value }))} />
            </label>
            <label>Next follow-up date
              <input type="date" disabled={saving} value={changes.follow_up_date} onChange={e => setChanges(v => ({ ...v, follow_up_date: e.target.value }))} />
            </label>
            <label className="gcr-update-wide">Outcome {CLOSED.includes(changes.status) && <span className="gcr-required">(required to close)</span>}
              <textarea rows={3} maxLength={4000} disabled={saving} value={changes.outcome} onChange={e => setChanges(v => ({ ...v, outcome: e.target.value }))} />
            </label>
            <label className="gcr-update-wide">Decision authority {['Resolved','Dismissed'].includes(changes.status) && <span className="gcr-required">(required)</span>}
              <input maxLength={300} disabled={saving} value={changes.decision_authority} onChange={e => setChanges(v => ({ ...v, decision_authority: e.target.value }))} />
            </label>
            <label className="gcr-update-wide">Update note <span className="gcr-required">(required)</span>
              <textarea rows={3} maxLength={4000} disabled={saving} value={changes.note} onChange={e => setChanges(v => ({ ...v, note: e.target.value }))} />
            </label>
          </div>
          {saveError && <p className="gcr-error" role="alert">{saveError}</p>}
        </section>}
        <section className="gcr-section" aria-label="Case details">
          <h4>Case details</h4>
          <Details rows={[
            ['Person filing', record.complainant],
            ['Person concerned', record.respondent],
            ['Homeowner', record.homeowner_name],
            ['Block', record.block],
            ['Lot number', record.lot_number],
            ['Location', record.location],
            ['Assigned person or committee', record.assigned_handler],
            ['Incident date', dateOnly(record.incident_date)],
            ['Follow-up date', dateOnly(record.follow_up_date)],
            ['Filed (Manila)', manilaDateTime(record.filed_at)],
            ['Last updated (Manila)', manilaDateTime(record.updated_at)],
          ]} />
        </section>
        <section className="gcr-section" aria-label="Complaint and action">
          <h4>Complaint and action</h4>
          <Details rows={[
            ['Description', record.description],
            ['Requested action', record.requested_action],
            ['Rule reference', record.rule_reference],
            ['Evidence notes', record.evidence_notes],
            ['Outcome', record.outcome],
            ['Decision authority', record.decision_authority],
          ]} />
        </section>
        <section className="gcr-section" aria-label="Case history">
          <h4>Case history <span>({events.length})</span></h4>
          {events.length === 0 ? <p className="gcr-message">No history entries are available for this case.</p> :
            <ol className="gcr-history">
              {events.map(event => <li key={event.id}>
                <div className="gcr-history-top">
                  <strong>{event.status || 'Activity recorded'}</strong>
                  <time>{manilaDateTime(event.recorded_at)}</time>
                </div>
                {event.previous_status && <p>Previous status: {event.previous_status}</p>}
                {event.note && <p className="gcr-history-note">{event.note}</p>}
                {event.recorded_by_name && <small>Recorded by {event.recorded_by_name}</small>}
              </li>)}
            </ol>}
        </section>
      </>}
    </div>
    <footer className="gc-footer">
      {editing ? <>
        <button className="gc-button gc-button-secondary" type="button" disabled={saving} onClick={() => { setEditing(false); setChanges(null); setSaveError('') }}>Cancel update</button>
        <button className="gc-button gc-button-primary" type="button" disabled={saving} onClick={saveUpdate}>{saving ? 'Saving…' : 'Save update'}</button>
      </> : <>
        {state === 'ready' && record && <button className="gc-button gc-button-secondary" type="button" onClick={() => { setChanges(editableFrom(record)); setSaveError(''); setSaveNotice(''); setEditing(true) }}>Update case</button>}
        <button className="gc-button gc-button-primary" type="button" onClick={onClose}>Close</button>
      </>}
    </footer>
  </div>
}
