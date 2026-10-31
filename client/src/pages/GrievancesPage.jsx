import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { useOrganization } from '../context/OrganizationContext'
import { useSuccessNotice } from '../lib/useSuccessNotice'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { Pager } from '../components/PagerControls'
import GrievanceEditor from '../components/GrievanceEditor'
import { applySearch } from '../lib/pagedQuery'
import { canUseGrievances, GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, grievanceNumber, grievanceRequest, newGrievance, manilaDateKey, statementMovement, statementRows } from '../lib/grievances'
import './GrievancesPage.css'

const PAGE_SIZE = 25
const SUMMARY_COLUMNS = 'id,case_number,title,category,status,complainant,respondent,location,assigned_handler,follow_up_date,filed_at,updated_at,block,lot_number'
function readableError(error) {
  return ['42P01','PGRST202','PGRST205'].includes(error?.code)
    ? 'Grievances is not set up yet. The database migration must be applied before records can be saved.'
    : error?.message || 'The request could not be completed. Please try again.'
}
export default function GrievancesPage({ user }) {
  const { organization } = useOrganization()
  const allowed = canUseGrievances(user)
  const [tab, setTab] = useState('register')
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search, 300)
  const [status, setStatus] = useState('All')
  const [category, setCategory] = useState('All')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useSuccessNotice()
  const [selected, setSelected] = useState(null)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const today = manilaDateKey()
  const [from, setFrom] = useState(`${today.slice(0,7)}-01`)
  const [to, setTo] = useState(today)
  const [report, setReport] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportError, setReportError] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!allowed) return undefined
    let cancelled = false
    setLoading(true); setError('')
    async function load() {
      let query = supabase.from('grievance_cases').select(SUMMARY_COLUMNS, { count: 'exact' })
      if (status !== 'All') query = query.eq('status',status)
      if (category !== 'All') query = query.eq('category',category)
      const number = /^GR-\d+$/i.test(term.trim()) ? Number(term.trim().slice(3)) : null
      const searched = number === null ? applySearch(query, ['title','complainant','respondent','location','assigned_handler'],term) : query.eq('case_number',number)
      const result = await searched
        .order('filed_at',{ascending:false}).order('id').range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1)
      if (cancelled) return
      setRows(result.data || []); setTotal(result.count || 0); setError(result.error ? readableError(result.error) : ''); setLoading(false)
      if (!result.error && page && page*PAGE_SIZE >= result.count) setPage(Math.max(0,Math.ceil(result.count/PAGE_SIZE)-1))
    }
    load()
    return () => { cancelled = true }
  }, [allowed,term,status,category,page,revision])

  useEffect(() => {
    if (!selected?.version) { setHistory([]); return undefined }
    let cancelled = false
    setHistoryLoading(true); setHistoryError('')
    fetchAll(() => supabase.from('grievance_events').select('*').eq('case_id',selected.id).order('recorded_at',{ascending:false}).order('id',{ascending:false}), { tiebreaker: null }).then(({data,error}) => {
      if (cancelled) return
      setHistory(data || []); setHistoryError(error ? readableError(error) : ''); setHistoryLoading(false)
    })
    return () => { cancelled = true }
  }, [selected?.id, selected?.version])

  async function openCase(row) {
    setOpening(true); setError('')
    const {data,error} = await supabase.from('grievance_cases').select('*').eq('id',row.id).single()
    setOpening(false)
    if (error) { setError(readableError(error)); return }
    setSaveError(''); setSelected(data)
  }
  async function save(form, note) {
    setSaveError('')
    let args
    try { args = grievanceRequest(form,note) } catch (error) { setSaveError(error.message); return }
    setSaving(true)
    try {
      const {data,error} = await supabase.rpc('save_grievance',args)
      if (error) throw error
      setSelected(null); setRevision((v) => v+1); setReport(null)
      setNotice(`${grievanceNumber(data.case_number)} ${form.version ? 'updated' : 'recorded'} successfully.`)
    } catch(error) { setSaveError(readableError(error)) } finally { setSaving(false) }
  }
  async function generateReport(event) {
    event?.preventDefault(); setReportError(''); setReport(null)
    if (!from || !to || from>to || to>today) { setReportError('Choose a valid period ending today or earlier.'); return }
    setReportBusy(true)
    try {
      const {data,error} = await supabase.rpc('grievance_statement',{p_from:from,p_to:to})
      if (error) throw error
      if (!statementMovement(data).reconciles) throw new Error('The case totals do not agree. Refresh and try again before exporting.')
      setReport(data); setNotice('Grievances statement generated successfully.')
    } catch(error) { setReportError(readableError(error)) } finally { setReportBusy(false) }
  }
  async function download() {
    if (!report) return
    setExporting(true)
    try {
      const { downloadGrievanceStatement } = await import('../lib/grievanceStatementPdf')
      downloadGrievanceStatement(report,organization,user?.full_name || user?.email || 'Secretary'); setNotice('Grievances statement PDF downloaded.')
    } catch(error) { setReportError(readableError(error)) } finally { setExporting(false) }
  }
  const schedule = (title, entries) => <section className="grievance-schedule"><h3>{title}</h3>{entries.length ? <dl>{entries.map(({label,count}) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl> : <p className="grievance-help">No open cases at period end.</p>}</section>
  if (!allowed) return <div className="grievances-page"><p role="alert">Grievances is available to the Secretary only.</p></div>
  return <main className="grievances-page">
    <header className="grievance-heading"><div><p className="grievance-eyebrow">Secretary workspace</p><h1>Grievances</h1><p>Record complaints, follow their progress and prepare period statements.</p></div><div className="grievance-buttons"><button onClick={() => { setRevision((v) => v+1); setReport(null) }} disabled={loading}>Refresh</button><button className="grievance-primary" onClick={() => { setSelected(newGrievance()); setSaveError('') }}>Record grievance</button></div></header>
    {notice && <p className="grievance-success" role="status">{notice}</p>}
    <div className="grievance-tabs" role="tablist" aria-label="Grievance views"><button role="tab" aria-selected={tab==='register'} onClick={() => setTab('register')}>Case register</button><button role="tab" aria-selected={tab==='statement'} onClick={() => setTab('statement')}>Period statement</button></div>
    {tab==='register' ? <section className="grievance-panel">
      <div className="grievance-filters"><label>Search<input type="search" placeholder="Search people, title, location or handler..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} /></label><label>Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}><option>All</option>{GRIEVANCE_STATUSES.map((v) => <option key={v}>{v}</option>)}</select></label><label>Category<select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0) }}><option>All</option>{GRIEVANCE_CATEGORIES.map((v) => <option key={v}>{v}</option>)}</select></label></div>
      {error && <p className="grievance-error" role="alert">{error}</p>}
      <p className="grievance-help">{loading ? 'Loading cases...' : `${total.toLocaleString('en-PH')} matching cases`}</p>
      {!loading && !error && !rows.length && <div className="grievance-empty"><h2>No grievances found</h2><p>Record a complaint or adjust your search filters.</p></div>}
      {!loading && rows.map((row) => <article className="grievance-case" key={row.id}><div><span className="grievance-case-number">{grievanceNumber(row.case_number)} · {row.category}</span><h2>{row.title}</h2><p>{row.complainant} <span>— complaint concerns —</span> {row.respondent}</p><small>{row.location} · Filed {organization.formatDate(row.filed_at)}</small><small>Handler: {row.assigned_handler || 'Not assigned'}{row.follow_up_date ? ` · Follow up ${organization.formatDate(row.follow_up_date)}` : ''}</small></div><div className="grievance-case-actions"><span className="grievance-badge">{row.status}</span><button onClick={() => openCase(row)} disabled={opening}>View / update</button></div></article>)}
      <Pager page={page} total={total} size={PAGE_SIZE} onPageChange={setPage} disabled={loading} />
    </section> : <section className="grievance-panel">
      <form className="grievance-period" onSubmit={generateReport}><label>From<input type="date" required disabled={reportBusy} max={today} value={from} onChange={(e) => { setFrom(e.target.value); setReport(null) }} /></label><label>To<input type="date" required disabled={reportBusy} max={today} value={to} onChange={(e) => { setTo(e.target.value); setReport(null) }} /></label><button className="grievance-primary" disabled={reportBusy}>{reportBusy ? 'Generating...' : 'Generate statement'}</button></form>
      {reportError && <p className="grievance-error" role="alert">{reportError}</p>}
      {!report && !reportBusy && <p className="grievance-help">Choose a period to see its opening cases, activity and closing position.</p>}
      {report && <div className="grievance-statement"><div className="grievance-statement-heading"><div><h2>Grievances Statement</h2><p>{report.from} to {report.to} · Philippine time</p></div><button onClick={download} disabled={exporting}>{exporting ? 'Preparing PDF...' : 'Download PDF'}</button></div>
        <table><thead><tr><th>Case movement</th><th>Cases</th></tr></thead><tbody>{statementRows(report).map(([label,count],i) => <tr key={label} className={i===3 || i===7 ? 'grievance-total' : ''}><td>{label}</td><td>{count}</td></tr>)}</tbody></table>
        <div className="grievance-schedules">{schedule('Open at end by status',report.statuses)}{schedule('Open at end by category',report.categories)}{schedule('Open at end by block',report.blocks)}{schedule('Age of open cases at period end',report.aging)}</div>
        <p className="grievance-help">Average days from original filing to closure: <strong>{report.average_days_to_close ?? 'No closures in this period'}</strong>. Each reopening and closure counts as a movement, including repeated movements of the same case. Referred cases remain open until closed.</p>
        <p className="grievance-help">Case counts only. This version does not assess fines, record collections or change homeowner balances.</p>
      </div>}
    </section>}
    {selected && <GrievanceEditor key={selected.id} initial={selected} busy={saving} error={saveError} history={history} historyLoading={historyLoading} historyError={historyError} onSave={save} onClose={() => { if (!saving) setSelected(null) }} formatDate={organization.formatDate} />}
  </main>
}
