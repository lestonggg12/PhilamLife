import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { monthBounds, monthDateBounds, monthTitle, periodLabel, formatLongDate } from '../lib/monthlyReportData'
import { secretaryRoleReport, treasurerRoleReport } from '../lib/roleReportData'
import DateField from '../components/DateField'
import Skeleton from '../components/skeleton/Skeleton'
import './ReportsPage.css'

const currentMonth = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return `${p.year}-${p.month}`
}
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

async function loadRoleSources(role, month) {
  const span = monthBounds(month)
  const dates = monthDateBounds(month)
  const common = supabase.from('system_settings').select('hoa_name,address').eq('id', 1).maybeSingle()
  const snapshotDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const nonVoided = field => q => q.or(`${field}.is.null,${field}.not.ilike.voided`)
  const results = role === 'secretary' ? await Promise.all([
    common,
    fetchAll(() => supabase.from('events').select('id,title,event_date,location')
      .gte('event_date',dates.from).lte('event_date',dates.to).order('event_date')),
    fetchAll(() => supabase.from('document_upload_report').select('id,title,category,created_at')
      .gte('created_at',span.start).lt('created_at',span.end).order('created_at')),
    fetchAll(() => supabase.from('properties')
      .select('id,block,lot_number,homeowner_name,homeowner_status,created_at,status_updated_at').order('id')),
    supabase.rpc('monthly_report_grievances', { p_from: dates.from, p_to: dates.to }),
  ]) : await Promise.all([
    common,
    fetchAll(() => nonVoided('status')(supabase.from('payments')
      .select('id,charge_type,amount_paid,paid_at,status').gte('paid_at',span.start).lt('paid_at',span.end)).order('paid_at')),
    fetchAll(() => nonVoided('payment_status')(supabase.from('service_transactions')
      .select('id,service_name,amount_paid,paid_at,payment_status').gte('paid_at',span.start).lt('paid_at',span.end)).order('paid_at')),
    fetchAll(() => nonVoided('status')(supabase.from('expenses')
      .select('id,category,description,reference_number,amount,expense_date,status')
      .gte('expense_date',dates.from).lte('expense_date',dates.to)).order('expense_date')),
    fetchAll(() => supabase.from('properties')
      .select('id,block,lot_number,homeowner_name,homeowner_status,property_classification').order('id')),
    fetchAll(() => supabase.from('property_overdue_summary')
      .select('property_id,is_overdue,days_overdue,overdue_amount,aging_complete,days_1_30_amount,days_31_60_amount,days_61_90_amount,days_90_plus_amount').order('property_id'), { tiebreaker: null }),
    fetchAll(() => supabase.from('collection_actions')
      .select('id,property_id,action_date,action_type').gte('action_date',span.start).lt('action_date',span.end)
      .order('action_date')),
    supabase.from('expense_budgets').select('budget_year,category,approved_annual_amount')
      .eq('budget_year', Number(month.slice(0,4))).order('category'),
  ])
  const failure = results.find(r => r.error)?.error
  if (failure) throw failure
  if (!results[0].data || !results.slice(1).every((r, index) =>
    role === 'secretary' && index === 3 ? Boolean(r.data) : Array.isArray(r.data))) {
    throw Error('A required source is unavailable. An incomplete report will not be generated.')
  }
  const report = role === 'secretary'
    ? secretaryRoleReport({ month, events: results[1].data, documents: results[2].data,
      properties: results[3].data, grievances: results[4].data })
    : treasurerRoleReport({ month, payments: results[1].data, services: results[2].data,
      expenses: results[3].data, properties: results[4].data, overdue: results[5].data,
      collectionActions: results[6].data, budgets: results[7].data, snapshotDate })
  return { report, organization: results[0].data }
}

function Table({ model }) {
  // treasurer-overdue-layout-v1: only the Treasurer confidential overdue table needs six balanced columns.
  const overdue = model.title === 'Overdue active accounts — confidential' && model.head.length === 6
  return <div className={overdue ? 'reports-table-wrap treasurer-overdue-table' : 'reports-table-wrap'}><table data-column-count={model.head.length}>
    <thead><tr>{model.head.map((v, i) => <th key={i}>{v}</th>)}</tr></thead>
    <tbody>{model.rows.length ? model.rows.map((row, i) => <tr key={i}>
      {row.map((v, j) => <td key={j} className={j === row.length - 1 ? 'is-right' : undefined}>{v}</td>)}
    </tr>) : <tr><td colSpan={model.head.length}>No records for the reporting period.</td></tr>}</tbody>
  </table></div>
}

export default function RoleReportsPage({ user, reportRole }) {
  const role = String(user?.role || '').trim().toLowerCase()
  const [month, setMonth] = useState(currentMonth)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const authorized = role === reportRole && ['secretary', 'treasurer'].includes(reportRole)
  const reload = useCallback(async () => {
    if (!authorized || !validMonth(month)) return
    setLoading(true); setError(''); setResult(null)
    try { setResult(await loadRoleSources(reportRole, month)) }
    catch (e) { setError(e.message || 'The report could not be verified.') }
    finally { setLoading(false) }
  }, [authorized, reportRole, month])
  useEffect(() => { void reload() }, [reload])
  if (!authorized) return <div role="alert">This report is not available to your account.</div>
  const report = result?.report
  const org = result?.organization
  const preparedBy = user?.full_name || `${reportRole[0].toUpperCase()}${reportRole.slice(1)}`
  const datePrepared = formatLongDate(new Date())
  const orgName = org?.hoa_name || 'Homeowners Association'
  const orgShort = orgName.replace(/\s*homeowners association\s*$/i, '').trim() || orgName
  async function downloadPdf() {
    if (!report || loading || exporting) return
    setExporting(true)
    try {
      // Re-fetch before export: never export a stale or partially loaded report.
      const fresh = await loadRoleSources(reportRole, month)
      const { buildRoleReportPdf } = await import('../lib/roleReportPdf')
      const doc = buildRoleReportPdf({ report: fresh.report, month, hoaName: fresh.organization.hoa_name,
        address: fresh.organization.address, preparedBy, datePrepared })
      doc.save(`${reportRole}-report-${month}.pdf`)
    } catch (e) { setError(e.message || 'PDF export failed.') }
    finally { setExporting(false) }
  }
  return <div className="reports-page">
    <header className="reports-header no-print">
      <div className="reports-header-main"><div className="reports-header-text">
        <span className="reports-header-eyebrow">{reportRole === 'secretary' ? 'Secretary Workspace' : 'Finance Workspace'}</span>
        <h1>{reportRole === 'secretary' ? 'Monthly Secretary Report' : 'Monthly Treasurer Report'}</h1>
        <p>Administrative &amp; Record-Keeping or Financial &amp; Fiduciary report, with the same official layout and print styling as the Admin report.</p>
      </div></div>
      <div className="reports-header-actions">
        <label className="monthly-month-picker">Report month
          <DateField ariaLabel="Report month" monthOnly value={month} onChange={setMonth}
            disabled={loading || exporting} clearable={false} />
        </label>
        <button type="button" className="reports-primary" onClick={() => window.print()}
          disabled={loading || !!error || !report}>Print</button>
        <button type="button" className="reports-primary" onClick={downloadPdf}
          disabled={loading || exporting || !!error || !report}>{exporting ? 'Preparing PDF…' : 'Download PDF'}</button>
      </div>
    </header>
    {error && <p className="reports-error" role="alert">Report unavailable: {error}. No partial report will be printed or exported.</p>}
    {loading ? <div className="reports-empty" aria-busy="true"><Skeleton variant="rect" height="200px" /><span>Verifying report data...</span></div>
      : !report || error ? <div className="reports-empty">Refresh the page to retry this reporting period.</div>
        : <main className="monthly-report-doc">
          <div className="monthly-cover">
            <h1 className="monthly-cover-org">{orgShort}</h1>
            <p className="monthly-cover-type">Homeowners Association</p>
            <hr className="monthly-cover-rule" />
            <p className="monthly-cover-label">{report.title}</p>
            <p className="monthly-cover-period">{monthTitle(month)}</p>
            {org.address && <p className="monthly-cover-address">{org.address}</p>}
            <dl className="monthly-cover-details">
              <div><dt>Reporting period</dt><dd>{periodLabel(month)}</dd></div>
              <div><dt>Prepared by</dt><dd>{preparedBy}</dd></div>
              <div><dt>Date prepared</dt><dd>{datePrepared}</dd></div>
            </dl>
          </div>
          <section className="monthly-section"><h2 className="monthly-section-title">Overview</h2>
            <div className="monthly-figure-band">{report.metrics.map(([label,value]) =>
              <div className="monthly-figure" key={label}><span className="monthly-figure-label">{label}</span>
                <strong className="monthly-figure-value">{value}</strong></div>)}</div>
            <p className="monthly-paragraph">{report.context}</p>
          </section>
          {report.sections.map(s => <section className="monthly-section" key={s.title}>
            <h2 className="monthly-section-title">{s.title}</h2><p className="monthly-paragraph monthly-note">{s.intro}</p>
            {s.tables.map(t => <React.Fragment key={t.title}>
              <h3 className="monthly-subheading">{t.title}</h3><Table model={t} />
            </React.Fragment>)}
            {s.note && <p className="monthly-paragraph monthly-note"><strong>Verification note:</strong> {s.note}</p>}
          </section>)}
          <section className="monthly-section"><h2 className="monthly-section-title">Basis of Preparation</h2>
            <p className="monthly-paragraph monthly-note">{report.basis}</p>
          </section>
          <div className="report-signatures"><div className="report-signature"><span className="report-signature-rule" />
            <strong>Prepared by</strong><span>{preparedBy}</span><span className="report-signature-date">Date:</span></div>
            <div className="report-signature"><span className="report-signature-rule" />
              <strong>Reviewed and approved by</strong><span className="report-signature-muted">Name and position</span>
              <span className="report-signature-date">Date:</span></div></div>
        </main>}
  </div>
}
