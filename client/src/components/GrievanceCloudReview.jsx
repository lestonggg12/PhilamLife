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
        if (active) {
          setResult({ state: 'ready', record, events: events || [], error: '' })
          setChanges(editableFrom(record))
          setEditing(true)
        }
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
  const statusTone = record && (CLOSED.includes(record.status) ? 'closed' : record.status === 'Received' ? 'open' : 'progress')
  return <div className="gc-modal-content gcr-modal" data-layout="details-left-narrative-right">
    <header className="gc-header gcr-detail-header">
      <div className="gc-header-copy">
        <p className="gcr-kicker">{record ? `GR-${record.case_number} · ${record.category}` : 'Grievance case'}</p>
        <h2 ref={titleRef} tabIndex={-1}>{record?.title || 'Case details'}</h2>
        {record ? <div className="gcr-meta"><span className={`gcr-status gcr-status-${statusTone}`}>{record.status}</span><span>Filed {manilaDateTime(record.filed_at)} by {record.complainant || 'Not provided'}</span><span>Follow-up {dateOnly(record.follow_up_date)}</span></div> : <p>Case details and recorded history</p>}
      </div>
      <button className="gc-icon-close" type="button" aria-label="Close case" onClick={onClose} disabled={saving}>×</button>
    </header>
    <div className="gc-body gcr-body">
      {state === 'loading' && <p role="status" className="gcr-message">Loading case details and history…</p>}
      {state === 'error' && <p role="alert" className="gcr-error">{error}</p>}
      {saveNotice && <p className="gcr-notice" role="status">{saveNotice}</p>}
      {state === 'ready' && record && <div className="gcr-detail-stack">
        <div className="gcr-overview-columns">
          <section className="gcr-card gcr-left-details" aria-label="Case details"><h3>Details</h3><Details rows={[
            ['Filed by', record.complainant], ['Concerns', record.respondent],
            ['Homeowner', record.homeowner_name], ['Block', record.block], ['Lot', record.lot_number],
            ['Location', record.location], ['Handler', record.assigned_handler],
            ['Incident date', dateOnly(record.incident_date)], ['Follow-up', dateOnly(record.follow_up_date)],
            ['Filed (Manila)', manilaDateTime(record.filed_at)], ['Updated (Manila)', manilaDateTime(record.updated_at)],
          ]} /></section>
          <div className="gcr-narrative-column">
            <section className="gcr-card" aria-label="What happened"><h3>What happened</h3><p className="gcr-prose">{record.description || 'No description recorded.'}</p></section>
          <section className="gcr-card" aria-label="Requested action"><h3>Requested action</h3><p className="gcr-prose">{record.requested_action || 'No requested action recorded.'}</p></section>
          {(record.outcome || record.decision_authority) && <section className="gcr-card" aria-label="Case outcome"><h3>Outcome</h3><p className="gcr-prose">{record.outcome || 'Not provided'}</p>{record.decision_authority && <p className="gcr-authority">Decision authority: {record.decision_authority}</p>}</section>}
          {(record.rule_reference || record.evidence_notes) && <section className="gcr-card" aria-label="Supporting information"><h3>Supporting information</h3><Details rows={[
            ['Rule reference', record.rule_reference], ['Evidence notes', record.evidence_notes],
          ]} /></section>}
          </div>
        </div>
        <section className="gcr-card" aria-label="Case history"><h3>Case history <span className="gcr-count">{events.length}</span></h3>
            {events.length === 0 ? <p className="gcr-message">No history entries are available for this case.</p> : <ol className="gcr-timeline">{events.map(event => <li key={event.id}>
              <strong>{event.previous_status && event.previous_status !== event.status ? `${event.previous_status} → ${event.status}` : event.status || 'Activity recorded'}</strong>
              <small>{manilaDateTime(event.recorded_at)}{event.recorded_by_name ? ` · ${event.recorded_by_name}` : ''}</small>
              {event.note && <p>{event.note}</p>}
            </li>)}</ol>}
          </section>
        <section className="gcr-card gcr-edit-card" aria-label="Update shared grievance"><h3>Update status</h3>
            {editing && changes ? <>
              <p className="gcr-help">Changes require an update note. Save when you are ready.</p>
              <div className="gcr-edit-fields">
                <label>Status<select value={changes.status} disabled={saving} onChange={e => setChanges(v => ({ ...v, status: e.target.value }))}>{STATUSES.map(status => <option value={status} key={status}>{status}</option>)}</select></label>
                <label>Assigned person or committee<input maxLength={200} disabled={saving} value={changes.assigned_handler} onChange={e => setChanges(v => ({ ...v, assigned_handler: e.target.value }))} /></label>
                <label>Next follow-up date<input type="date" disabled={saving} value={changes.follow_up_date} onChange={e => setChanges(v => ({ ...v, follow_up_date: e.target.value }))} /></label>
                {(CLOSED.includes(changes.status) || changes.outcome) && <label>Outcome {CLOSED.includes(changes.status) && <span className="gcr-required">(required)</span>}<textarea rows={3} maxLength={4000} disabled={saving} value={changes.outcome} onChange={e => setChanges(v => ({ ...v, outcome: e.target.value }))} /></label>}
                {(CLOSED.includes(changes.status) || changes.decision_authority) && <label>Decision authority {['Resolved', 'Dismissed'].includes(changes.status) && <span className="gcr-required">(required)</span>}<input maxLength={300} disabled={saving} value={changes.decision_authority} onChange={e => setChanges(v => ({ ...v, decision_authority: e.target.value }))} /></label>}
                <label>Update note <span className="gcr-required">(required)</span><textarea rows={3} maxLength={4000} disabled={saving} value={changes.note} onChange={e => setChanges(v => ({ ...v, note: e.target.value }))} placeholder="Explain the status change or follow-up." /></label>
              </div>
              {saveError && <p className="gcr-error" role="alert">{saveError}</p>}
              <button className="gcr-save-button" type="button" disabled={saving} onClick={saveUpdate}>{saving ? 'Saving…' : 'Save update'}</button>
            </> : <><p className="gcr-help">Update the status, assignment or follow-up and record an audit note.</p><button className="gcr-save-button" type="button" onClick={() => { setChanges(editableFrom(record)); setSaveError(''); setSaveNotice(''); setEditing(true) }}>Update case</button></>}
          </section>
      </div>}
    </div>
    <footer className="gc-footer gcr-footer"><small>Case details and audit history · Philippine time</small><div>{editing && <button className="gc-button gc-button-secondary" type="button" disabled={saving} onClick={() => { setChanges(editableFrom(record)); setSaveError(''); setEditing(false) }}>Cancel update</button>}<button className="gc-button gc-button-primary" type="button" onClick={onClose} disabled={saving}>Close case</button></div></footer>
  </div>
}
