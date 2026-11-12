import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import DateField, { todayKey } from './DateField'
import { isCalendarDate } from '../lib/eventCalendar'
import { statementMovement, statementRows } from '../lib/grievances'
import './GrievancePeriodStatement.css'

const REPORT_FIELDS = ['opening', 'received', 'reopened', 'resolved', 'dismissed', 'withdrawn', 'closing']
const GROUP_FIELDS = ['statuses', 'categories', 'blocks', 'aging']
const monthStart = (date) => `${date.slice(0, 7)}-01`

function validatePeriod(from, to, today) {
  if (!isCalendarDate(from) || !isCalendarDate(to)) return 'Choose valid start and end dates.'
  if (from > to) return 'The start date must be on or before the end date.'
  if (to > today) return 'The reporting period cannot end in the future (Manila time).'
  return ''
}

function validateStatement(report, from, to) {
  if (!report || typeof report !== 'object' || report.from !== from || report.to !== to) {
    throw new Error('The database did not return the requested reporting period.')
  }
  if (REPORT_FIELDS.some(key => !Number.isSafeInteger(Number(report[key])) || Number(report[key]) < 0 || report[key] == null)) {
    throw new Error('The grievance statement contains missing or invalid case totals.')
  }
  for (const key of GROUP_FIELDS) {
    if (!Array.isArray(report[key]) || report[key].some(row => !row || typeof row.label !== 'string' || !Number.isSafeInteger(Number(row.count)) || Number(row.count) < 0 || row.count == null)) {
      throw new Error('The grievance statement contains incomplete breakdown data.')
    }
  }
  const movement = statementMovement(report)
  if (!movement.reconciles) throw new Error('Opening, received, reopened and closed cases do not reconcile with the ending balance. No statement will be exported.')
  const sum = key => report[key].reduce((total, row) => total + Number(row.count), 0)
  if (sum('statuses') !== Number(report.closing) || sum('categories') !== Number(report.closing) || sum('blocks') !== Number(report.closing) || sum('aging') !== Number(report.closing)) {
    throw new Error('The ending-case breakdowns do not match the closing total. No statement will be exported.')
  }
  if (!report.generated_at || Number.isNaN(Date.parse(report.generated_at))) throw new Error('The report generation timestamp is invalid.')
  return movement
}

async function fetchStatement(from, to) {
  const { data, error } = await supabase.rpc('grievance_statement', { p_from: from, p_to: to })
  if (error) throw error
  validateStatement(data, from, to)
  return data
}

function SummarySection({ title, rows }) {
  return <section className="gps-panel" aria-label={title}>
    <h3>{title}</h3>
    <div className="gps-table-wrap"><table><thead><tr><th scope="col">Group</th><th scope="col">Cases</th></tr></thead>
      <tbody>{rows.length ? rows.map((row, index) => <tr key={`${row[0]}-${index}`}><th scope="row">{row[0]}</th><td>{row[1]}</td></tr>) : <tr><td colSpan={2}>No cases for this breakdown.</td></tr>}</tbody>
    </table></div>
  </section>
}

export default function GrievancePeriodStatement() {
  const [from, setFrom] = useState(() => monthStart(todayKey()))
  const [to, setTo] = useState(() => todayKey())
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const requestId = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestId.current += 1 }
  }, [])

  const invalidate = () => { requestId.current += 1; setReport(null); setError('') }
  const changeFrom = value => { invalidate(); setFrom(value) }
  const changeTo = value => { invalidate(); setTo(value) }
  const periodError = validatePeriod(from, to, todayKey())

  async function generate(event) {
    event.preventDefault()
    if (busy) return
    const validation = validatePeriod(from, to, todayKey())
    if (validation) { setReport(null); setError(validation); return }
    const sequence = ++requestId.current
    setBusy('generate'); setReport(null); setError('')
    try {
      const result = await fetchStatement(from, to)
      if (mounted.current && requestId.current === sequence) setReport(result)
    } catch (cause) {
      if (mounted.current && requestId.current === sequence) setError(cause?.message || 'Unable to generate the grievance statement.')
    } finally {
      if (mounted.current && requestId.current === sequence) setBusy('')
    }
  }

  async function downloadPdf() {
    if (!report || busy || periodError) return
    const sequence = ++requestId.current
    setBusy('export'); setError('')
    try {
      // Fetch a new verified snapshot; do not export stale or partially loaded figures.
      const fresh = await fetchStatement(from, to)
      const { data: settings, error: settingsError } = await supabase.from('system_settings')
        .select('hoa_name,address').eq('id', 1).maybeSingle()
      if (settingsError) throw settingsError
      if (!mounted.current || requestId.current !== sequence) return
      const { downloadGrievanceStatement } = await import('../lib/grievanceStatementPdf')
      if (!mounted.current || requestId.current !== sequence) return
      downloadGrievanceStatement(fresh, settings || {}, 'Secretary')
      setReport(fresh)
    } catch (cause) {
      if (mounted.current && requestId.current === sequence) setError(cause?.message || 'The PDF could not be prepared.')
    } finally {
      if (mounted.current && requestId.current === sequence) setBusy('')
    }
  }

  const movement = report ? statementMovement(report) : null
  return <section className="gps-page" role="tabpanel" aria-label="Grievance period statement">
    <div className="gps-header"><div><p className="gps-eyebrow">Secretary workspace · Shared database</p>
      <h2>Grievance period statement</h2>
      <p>Official case counts from Supabase history. Browser-local complaints are not included.</p>
    </div></div>
    <form className="gps-controls" onSubmit={generate}>
      <div className="gps-date"><label>From</label><DateField ariaLabel="Statement start date" value={from} max={todayKey()} onChange={changeFrom} clearable={false} disabled={Boolean(busy)} /></div>
      <div className="gps-date"><label>To</label><DateField ariaLabel="Statement end date" value={to} max={todayKey()} onChange={changeTo} clearable={false} disabled={Boolean(busy)} /></div>
      <button className="gps-primary" type="submit" disabled={Boolean(busy) || Boolean(periodError)}>{busy === 'generate' ? 'Generating…' : 'Generate statement'}</button>
      <button className="gps-secondary" type="button" onClick={downloadPdf} disabled={!report || Boolean(busy) || Boolean(periodError)}>{busy === 'export' ? 'Preparing PDF…' : 'Download PDF'}</button>
    </form>
    {periodError && <p className="gps-error" role="alert">{periodError}</p>}
    {error && <p className="gps-error" role="alert">{error}</p>}
    {busy === 'generate' && <p role="status" className="gps-message">Verifying grievance history and period totals…</p>}
    {!report && !busy && !error && !periodError && <p className="gps-message">Select a reporting period and generate the statement. No case records will be changed.</p>}
    {report && movement && <div className="gps-results">
      <div className="gps-result-heading"><div><h3>Statement for {report.from} to {report.to}</h3><p>Generated from shared grievance history · Philippine time</p></div>
        <span className="gps-reconciled" role="status">Reconciled</span>
      </div>
      <div className="gps-metrics">
        <div><span>Opening cases</span><strong>{report.opening}</strong></div>
        <div><span>New complaints</span><strong>{report.received}</strong></div>
        <div><span>Cases closed</span><strong>{movement.closed}</strong></div>
        <div><span>Closing cases</span><strong>{report.closing}</strong></div>
      </div>
      <SummarySection title="Case movement" rows={statementRows(report)} />
      <div className="gps-breakdowns">
        <SummarySection title="Open at end by status" rows={report.statuses.map(row => [row.label, row.count])} />
        <SummarySection title="Open at end by category" rows={report.categories.map(row => [row.label, row.count])} />
        <SummarySection title="Open at end by block" rows={report.blocks.map(row => [row.label, row.count])} />
        <SummarySection title="Age of open cases at period end" rows={report.aging.map(row => [row.label, row.count])} />
      </div>
      <p className="gps-note">Referred cases are counted as open. Every qualifying closure and reopening is counted as an event, including repeated movements of one case. This statement does not include complaint descriptions, payments, or browser-local records.</p>
    </div>}
  </section>
}
