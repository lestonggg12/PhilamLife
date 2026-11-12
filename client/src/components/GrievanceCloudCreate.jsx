import React, { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { saveNewGrievanceToCloud } from '../lib/grievanceCloud'

const CATEGORIES = ['Noise', 'Parking', 'Pets', 'Maintenance', 'Neighbor dispute',
  'Dues or payment dispute', 'Rule violation', 'Officer conduct', 'Other']

const EMPTY = {
  title: '', category: 'Noise', filedBy: '', concerns: '', location: '',
  description: '', requestedAction: '', handler: '', incidentDate: '', followUp: '',
}

const fieldStyle = { display: 'grid', gap: 5, minWidth: 0, flex: '1 1 220px' }
const inputStyle = { padding: '9px 11px', borderRadius: 8, border: '1px solid #a8bacb',
  font: 'inherit', width: '100%', boxSizing: 'border-box' }

function Field({ label, children }) {
  return <label style={fieldStyle}><span>{label}</span>{children}</label>
}

export default function GrievanceCloudCreate({ onSaved }) {
  const [draft, setDraft] = useState(EMPTY)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const pendingId = useRef(null)
  const savingRef = useRef(false)

  function change(key, value) {
    setDraft(current => ({ ...current, [key]: value }))
    setSuccess('')
  }

  async function submit(event) {
    event.preventDefault()
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    setSuccess('')

    // A stable UUID makes retries idempotent if the network fails after saving.
    if (!pendingId.current) pendingId.current = crypto.randomUUID()
    const requestId = pendingId.current

    try {
      const saved = await saveNewGrievanceToCloud(supabase, draft, note, requestId)
      pendingId.current = null
      setDraft({ ...EMPTY })
      setNote('')
      setSuccess(`Shared case GR-${saved.case_number} saved successfully.`)
      onSaved?.()
    } catch (failure) {
      setError(`${failure?.message || 'The shared record could not be confirmed.'} If the connection dropped, check the shared cases preview before retrying.`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section aria-label="Create new shared grievance" style={{
      padding: 16, margin: '12px 0', background: '#fff', border: '1px solid #b8c7d8', borderRadius: 12,
    }}>
      <h2 style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>Pilot: record a new shared grievance</h2>
      <p style={{ margin: '0 0 12px' }}>New entries here are saved to Supabase only.
        Existing browser-stored complaints are not changed or imported.</p>
      <form onSubmit={submit}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Field label="Complaint title *"><input style={inputStyle} required maxLength={160}
            value={draft.title} onChange={e => change('title', e.target.value)} /></Field>
          <Field label="Category *"><select style={inputStyle} value={draft.category}
            onChange={e => change('category', e.target.value)}>
            {CATEGORIES.map(value => <option key={value}>{value}</option>)}
          </select></Field>
          <Field label="Person filing *"><input style={inputStyle} required maxLength={200}
            value={draft.filedBy} onChange={e => change('filedBy', e.target.value)} /></Field>
          <Field label="Person or group concerned *"><input style={inputStyle} required maxLength={200}
            value={draft.concerns} onChange={e => change('concerns', e.target.value)} /></Field>
          <Field label="Location *"><input style={inputStyle} required maxLength={300}
            value={draft.location} onChange={e => change('location', e.target.value)} /></Field>
          <Field label="Assigned person or committee"><input style={inputStyle} maxLength={200}
            value={draft.handler} onChange={e => change('handler', e.target.value)} /></Field>
          <Field label="Incident date"><input style={inputStyle} type="date"
            value={draft.incidentDate} onChange={e => change('incidentDate', e.target.value)} /></Field>
          <Field label="Next follow-up date"><input style={inputStyle} type="date"
            value={draft.followUp} onChange={e => change('followUp', e.target.value)} /></Field>
          <Field label="Description *"><textarea style={inputStyle} required rows={3} maxLength={6000}
            value={draft.description} onChange={e => change('description', e.target.value)} /></Field>
          <Field label="Requested action"><textarea style={inputStyle} rows={3} maxLength={3000}
            value={draft.requestedAction} onChange={e => change('requestedAction', e.target.value)} /></Field>
          <Field label="Filing note *"><textarea style={inputStyle} required rows={3} maxLength={4000}
            value={note} onChange={e => { setNote(e.target.value); setSuccess('') }} /></Field>
        </div>
        {error && <p role="alert" style={{ color: '#9f2222' }}>{error}</p>}
        {success && <p role="status" style={{ color: '#14633e' }}>{success}</p>}
        <button type="submit" disabled={saving} style={{
          padding: '11px 18px', marginTop: 12, background: '#1464a0',
          color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer',
        }}>{saving ? 'Saving to shared database…' : 'Save new case to shared database'}</button>
      </form>
    </section>
  )
}
