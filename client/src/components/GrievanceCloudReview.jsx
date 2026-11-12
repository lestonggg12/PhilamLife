import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './GrievanceCloudReview.css'

const CASE_FIELDS = [
  'id', 'case_number', 'title', 'category', 'status', 'complainant', 'respondent',
  'homeowner_name', 'block', 'lot_number', 'location', 'description',
  'requested_action', 'incident_date', 'assigned_handler', 'follow_up_date',
  'rule_reference', 'evidence_notes', 'outcome', 'decision_authority',
  'filed_at', 'updated_at',
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

export default function GrievanceCloudReview({ caseId, onClose }) {
  const [result, setResult] = useState({ state: 'loading', record: null, events: [], error: '' })
  const titleRef = useRef(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    let active = true
    setResult({ state: 'loading', record: null, events: [], error: '' })
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

  const { state, record, events, error } = result
  return <div className="gc-modal-content gcr-modal">
    <header className="gc-header">
      <div className="gc-header-copy">
        <h2 ref={titleRef} tabIndex={-1}>Review shared grievance</h2>
        <p>Read-only details from the shared case register</p>
      </div>
      <button className="gc-icon-close" type="button" aria-label="Close" onClick={onClose}>×</button>
    </header>
    <div className="gc-body gcr-body">
      {state === 'loading' && <p role="status" className="gcr-message">Loading case details and history…</p>}
      {state === 'error' && <p role="alert" className="gcr-error">{error}</p>}
      {state === 'ready' && record && <>
        <div className="gcr-hero">
          <span className="gcr-ref">GR-{record.case_number}</span>
          <span className="gcr-status">{record.status}</span>
          <h3>{record.title}</h3>
          <p>{record.category}</p>
        </div>
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
    <footer className="gc-footer"><button className="gc-button gc-button-primary" type="button" onClick={onClose}>Close</button></footer>
  </div>
}
