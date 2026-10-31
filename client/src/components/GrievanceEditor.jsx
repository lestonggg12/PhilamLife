import React, { useEffect, useRef, useState } from 'react'
import GrievanceLotPicker from './GrievanceLotPicker'
import { GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, grievanceNumber, isGrievanceClosed, manilaDateKey } from '../lib/grievances'

export default function GrievanceEditor({ initial, busy, error, history, historyLoading, historyError, onSave, onClose, formatDate }) {
  const [form, setForm] = useState(initial)
  const [note, setNote] = useState('')
  const panelRef = useRef(null)
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  useEffect(() => {
    const previous = document.activeElement
    panelRef.current?.querySelector('input')?.focus()
    return () => previous?.focus?.()
  }, [])
  function keys(event) {
    if (event.key === 'Escape' && !busy) onClose()
    if (event.key !== 'Tab') return
    const nodes = [...panelRef.current.querySelectorAll('button,input,select,textarea,summary')].filter((n) => !n.disabled && n.getClientRects().length)
    const first = nodes[0]; const last = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const text = (key, label, max = 200, required = false) => <label>{label}<input value={form[key] || ''} onChange={(e) => update(key, e.target.value)} maxLength={max} required={required} /></label>
  const area = (key, label, max = 4000, required = false) => <label className="grievance-wide">{label}<textarea rows={3} value={form[key] || ''} onChange={(e) => update(key, e.target.value)} maxLength={max} required={required} /></label>
  return <div className="grievance-overlay">
    <section ref={panelRef} className="grievance-dialog" role="dialog" aria-modal="true" aria-labelledby="grievance-editor-title" onKeyDown={keys}>
      <header><div><p className="grievance-eyebrow">{initial.version ? grievanceNumber(initial.case_number) : 'New complaint'}</p><h2 id="grievance-editor-title">{initial.version ? 'Case details' : 'Record a grievance'}</h2></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close case">×</button></header>
      <form onSubmit={(e) => { e.preventDefault(); onSave(form, note) }}>
        <fieldset disabled={busy}>
          <div className="grievance-form-grid">
            <label className="grievance-wide">Title<input value={form.title} onChange={(e) => update('title',e.target.value)} maxLength={160} required /></label>
            <label>Category<select aria-label="Category" value={form.category} onChange={(e) => update('category',e.target.value)}>{GRIEVANCE_CATEGORIES.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>Status<select aria-label="Status" value={form.status} disabled={!initial.version} onChange={(e) => update('status',e.target.value)}>{GRIEVANCE_STATUSES.map((v) => <option key={v}>{v}</option>)}</select></label>
            {text('complainant','Person making the complaint',200,true)}
            {text('respondent','Person or group the complaint concerns',200,true)}
            <div className="grievance-wide"><label>Affected lot (optional)</label><GrievanceLotPicker value={form.property_id} label={initial.property_id ? `${initial.homeowner_name} — ${initial.block}, Lot ${initial.lot_number}` : ''} onChange={(lot) => setForm((current) => ({ ...current, property_id: lot?.id || '', ...(lot ? { location: `${lot.block}, Lot ${lot.lot_number}` } : {}) }))} /></div>
            {text('location','Location or common area',300,true)}
            <label>Incident date (optional)<input type="date" max={manilaDateKey()} value={form.incident_date || ''} onChange={(e) => update('incident_date',e.target.value)} /></label>
            {area('description','What happened?',6000,true)}
            {area('requested_action','What action is requested?',3000)}
            {text('assigned_handler','Assigned person or committee')}
            <label>Next follow-up date<input type="date" value={form.follow_up_date || ''} onChange={(e) => update('follow_up_date',e.target.value)} /></label>
          </div>
          <details open={isGrievanceClosed(form.status) || undefined}><summary>Supporting details and decision</summary><div className="grievance-form-grid">
            {area('rule_reference','Relevant rule or bylaw',1000)}
            {area('evidence_notes','Evidence notes / document references')}
            <p className="grievance-help grievance-wide">Record document names or references here. This version does not upload files or post fines.</p>
            {area('outcome','Outcome or agreed action')}
            {text('decision_authority','Decision authorized by',300)}
            <p className="grievance-help grievance-wide">Record the committee, board resolution or authorized decision-maker. Saving a case does not itself authorize a sanction. Closing as Resolved or Dismissed requires an outcome and decision authority.</p>
          </div></details>
          {isGrievanceClosed(initial.status) && !isGrievanceClosed(form.status) && <p className="grievance-help">You are reopening a closed case. Explain why in the update note.</p>}
          <label>{initial.version ? 'Update note (required)' : 'Filing note (required)'}<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} required /></label>
          {error && <p className="grievance-error" role="alert">{error}</p>}
          <footer><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="grievance-primary">{busy ? 'Saving...' : initial.version ? 'Save update' : 'Record grievance'}</button></footer>
        </fieldset>
      </form>
      {initial.version > 0 && <section className="grievance-history"><h3>Case history</h3>{historyLoading ? <p>Loading history...</p> : historyError ? <p role="alert" className="grievance-error">{historyError}</p> : history.map((event) => <article key={event.id}><strong>{event.previous_status ? `${event.previous_status} → ${event.status}` : 'Complaint received'}</strong><small>{formatDate(event.recorded_at, { withTime: true })} · {event.recorded_by_name}</small><p>{event.note}</p>{event.snapshot?.outcome && <p>Outcome: {event.snapshot.outcome}</p>}{event.snapshot?.decision_authority && <p>Authorized by: {event.snapshot.decision_authority}</p>}</article>)}</section>}
    </section>
  </div>
}
