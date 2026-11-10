
import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { annualMoney, buildAnnualReportView, summarizeAnnualGrievances } from '../lib/annualReportData'
import { monthTitle, formatDateOnly, formatReportDate, grievanceRows,
  grievanceNote, incomeTableRows, collectionsRows, formatLongDate } from '../lib/monthlyReportData'
import { manilaMonth } from '../hooks/useManilaMonthRollover'
import './ReportsPage.css'

const currentYear = () => Number(manilaMonth().slice(0, 4))
const fmt = annualMoney

function Table({ headings, rows, totalRow = false, rightCols = [] }) {
  return <div className="reports-table-wrap"><table>
    <thead><tr>{headings.map((h) => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className={totalRow && i === rows.length - 1 ? 'monthly-row-total' : undefined}>
      {r.map((v, j) => <td key={j} className={rightCols.includes(j) ? 'is-right' : undefined}>{v}</td>)}
    </tr>)}</tbody>
  </table></div>
}
function Section({ title, children }) {
  return <section className="monthly-section"><h2 className="monthly-section-title">{title}</h2>{children}</section>
}
function Figure({ label, value }) {
  return <div className="monthly-figure"><span className="monthly-figure-label">{label}</span><strong className="monthly-figure-value">{value}</strong></div>
}

async function fetchAnnual(year, preparedDate) {
  const start = year + '-01-01'
  const end = String(Number(year) + 1) + '-01-01'
  const first = start + 'T00:00:00+08:00'
  const after = end + 'T00:00:00+08:00'
  const grievanceMonths = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, '0')
    const last = new Date(Date.UTC(Number(year), index + 1, 0)).getUTCDate()
    return {
      from: year + '-' + month + '-01',
      to: year + '-' + month + '-' + String(last).padStart(2, '0'),
    }
  })
  const queries = [
    fetchAll(() => supabase.from('monthly_collections')
      .select('month_start,dues_collected,service_collected')
      .gte('month_start', start).lt('month_start', end).order('month_start'), { tiebreaker: null }),
    fetchAll(() => supabase.from('payments')
      .select('id,paid_at,status,charge_type,amount_paid,amount')
      .or('status.is.null,status.not.ilike.voided').gte('paid_at', first).lt('paid_at', after).order('paid_at')),
    fetchAll(() => supabase.from('service_transactions')
      .select('id,paid_at,payment_status,service_name,amount_paid')
      .or('payment_status.is.null,payment_status.not.ilike.voided').gte('paid_at', first).lt('paid_at', after).order('paid_at')),
    fetchAll(() => supabase.from('expenses')
      .select('id,expense_date,amount,status,category,description,reference_number,supporting_note,recorded_by_name')
      .gte('expense_date',start).lt('expense_date',end).order('expense_date')),
    fetchAll(() => supabase.from('properties')
      .select('id,homeowner_status,current_balance').order('id')),
    fetchAll(() => supabase.from('property_overdue_summary')
      .select('property_id,balance,is_overdue').order('property_id'), { tiebreaker: null }),
    supabase.from('credit_liability_summary').select('*').maybeSingle(),
    supabase.from('system_settings').select('hoa_name,address').eq('id',1).maybeSingle(),
    fetchAll(() => supabase.from('events')
      .select('id,title,event_date,location').gte('event_date',start).lt('event_date',end).order('event_date')),
    fetchAll(() => supabase.from('document_upload_report')
      .select('id,title,category,created_at').gte('created_at',first).lt('created_at',after).order('created_at')),
    Promise.all(grievanceMonths.map(({ from, to }) =>
      supabase.rpc('monthly_report_grievances', {
        p_from: from,
        p_to: to,
      })
    )),
  ]
  const result = await Promise.all(queries)
  const error = result.find((r) => r.error)?.error
  if (error) throw error
  if (![0,1,2,3,4,5,8,9].every((i) => Array.isArray(result[i].data)) ||
      !result[6].data || !result[7].data || !Array.isArray(result[10]) || result[10].length !== 12) {
    throw new Error('A required annual report source returned incomplete data.')
  }
  const grievanceError = result[10].find((entry) => entry.error)?.error
  if (grievanceError) throw grievanceError

  const grievances = summarizeAnnualGrievances(
    year,
    result[10].map((entry) => entry.data)
  )

  const report = buildAnnualReportView({
    year, currentMonth: manilaMonth(), datePrepared: preparedDate,
    collections: result[0].data, payments: result[1].data,
    serviceTransactions: result[2].data, expenses: result[3].data,
    properties: result[4].data, overdue: result[5].data,
    credits: result[6].data, events: result[8].data,
    documents: result[9].data, grievances,
  })
  return { report, settings: result[7].data }
}

export default function AnnualReportsPage() {
  const [year, setYear] = useState(currentYear)
  const [snapshot, setSnapshot] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const token = useRef(0)
  const yearRef = useRef(year)
  yearRef.current = year
  const preparedDate = formatLongDate(new Date())

  useEffect(() => {
    const request = ++token.current
    setLoading(true)
    setError('')
    setSnapshot(null)
    fetchAnnual(year, formatLongDate(new Date())).then((value) => {
      if (request === token.current) setSnapshot({ ...value, year })
    }).catch((failure) => {
      if (request === token.current) setError(failure?.message || 'Unable to load annual records.')
    }).finally(() => {
      if (request === token.current) setLoading(false)
    })
    return () => { token.current++ }
  }, [year])

  async function downloadPdf() {
    if (loading || error || exporting || !snapshot || snapshot.year !== year) return
    setExporting(true)
    try {
      const selected = year
      const { report, settings } = await fetchAnnual(selected, formatLongDate(new Date()))
      if (yearRef.current !== selected) return
      const { buildAnnualReportPdf } = await import('../lib/annualReportPdf')
      const doc = buildAnnualReportPdf({ report, hoaName: settings.hoa_name,
        hoaAddress: settings.address, preparedBy: 'HOA Management',
        datePrepared: formatLongDate(new Date()) })
      doc.save('HOA-Annual-Management-Report-' + selected + '.pdf')
    } catch (failure) {
      setError('Could not generate annual PDF: ' + (failure?.message || 'Unknown error.'))
    } finally { setExporting(false) }
  }

  const years = Array.from({ length: Math.max(1, currentYear() - 2026 + 1) }, (_, i) => currentYear() - i)
  const verified = !loading && !error && snapshot?.year === year
  const report = verified ? snapshot.report : null
  const heading = snapshot?.settings?.hoa_name || 'Homeowners Association'
  const shortName = heading.replace(/\s*homeowners association\s*$/i, '').trim() || heading
  const activities = report?.events.thisMonth || []
  const docs = report?.documents.thisMonth || []

  return <div className="reports-page">
    <header className="reports-header no-print">
      <div className="reports-header-main"><div className="reports-header-text">
        <span className="reports-header-eyebrow">Finance Workspace</span>
        <h1>Annual Management Report</h1>
        <p>Review yearly reports with the same sections as Monthly Management Reports.</p>
        <Link to="/reports">Back to Monthly Reports</Link>
      </div></div>
      <div className="reports-header-actions">
        <label className="monthly-month-picker">Report year
          <select aria-label="Reporting year" value={year} disabled={exporting}
            onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="button" className="reports-primary" onClick={downloadPdf}
          disabled={!verified || exporting}>{exporting ? 'Preparing PDF...' : 'Download Annual PDF'}</button>
      </div>
    </header>
    {loading ? <div className="reports-empty" role="status">Verifying full annual report data...</div>
      : !report ? <div className="reports-empty" role="alert"><strong>Annual report unavailable</strong>
        <p>{error || 'The selected year has not been verified.'}</p></div>
      : <main className="monthly-report-doc">
        <div className="monthly-cover">
          <h1 className="monthly-cover-org">{shortName}</h1>
          <p className="monthly-cover-type">Homeowners Association</p>
          <hr className="monthly-cover-rule"/>
          <p className="monthly-cover-label">Annual Management Report</p>
          <p className="monthly-cover-period">{year}</p>
          {snapshot.settings.address && <p className="monthly-cover-address">{snapshot.settings.address}</p>}
          <dl className="monthly-cover-details">
            <div><dt>Reporting period</dt><dd>January 1 - December 31, {year}{report.annual.yearToDate ? ' (year to date)' : ''}</dd></div>
            <div><dt>Prepared by</dt><dd>HOA Management</dd></div>
            <div><dt>Date prepared</dt><dd>{preparedDate}</dd></div>
          </dl>
        </div>
        <Section title="1. Executive Summary">
          <div className="monthly-figure-band">
            <Figure label="Total revenue" value={fmt(report.kpis.totalIncome)}/>
            <Figure label="Disbursements" value={fmt(report.kpis.totalExpenses)}/>
            <Figure label={report.kpis.netIncome >= 0 ? 'Net surplus' : 'Net deficit'} value={fmt(Math.abs(report.kpis.netIncome))}/>
            <Figure label="Outstanding balances (current)" value={fmt(report.kpis.totalOutstanding)}/>
          </div>
          <h3 className="monthly-subheading">Management overview</h3>
          <p className="monthly-paragraph">{report.narrative.overview}</p>
        </Section>
        <Section title="2. Financial Report">
          <h3 className="monthly-subheading">2.0 Monthly Financial Summary</h3>
          <Table headings={['Month','Homeowners','Services','Income','Expenses','Net']} rightCols={[1,2,3,4,5]} totalRow rows={[
            ...report.monthlySummary.map((m) => [monthTitle(m.month),
              ...[m.homeowner,m.service,m.income,m.expenses,m.net].map((v) => m.future ? '--' : fmt(v))]),
            ['Annual totals',fmt(report.annual.homeowner),fmt(report.annual.service),fmt(report.annual.income),fmt(report.annual.expenses),fmt(report.annual.net)],
          ]}/>
          <h3 className="monthly-subheading">2.1 Income</h3>
          <Table headings={['Revenue category','Amount']} rightCols={[1]} totalRow rows={incomeTableRows(report.income,fmt)}/>
          <h3 className="monthly-subheading">2.2 Disbursements</h3>
          <p className="monthly-paragraph monthly-note">{report.narrative.expenseIntro}</p>
          {report.expenses.byCategory.length > 0 && <Table headings={['Category','Entries','Amount']} rightCols={[1,2]} totalRow rows={[
            ...report.expenses.byCategory.map((c) => [c.category,String(c.count),fmt(c.amount)]),
            ['Total expenses', String(report.expenses.entryCount),fmt(report.expenses.totalExpenses)],
          ]}/>}
          {report.expenses.entries.length > 0 && <><h3 className="monthly-subheading">Expense detail</h3>
            <Table headings={['Date','Category','Description','Ref. no.','Recorded by','Amount']} rightCols={[5]} rows={
              report.expenses.entries.map((e) => [formatDateOnly(e.expense_date),e.category,e.description || '--',
                e.reference_number || (e.supporting_note ? 'No ref. (explained)' : '--'),
                e.recorded_by_name || '--',fmt(e.amount)])}/></>}
          <h3 className="monthly-subheading">2.3 Accounts Receivable and Collections</h3>
          <Table headings={['Measure','Value']} rightCols={[1]} rows={collectionsRows(report.receivables)}/>
          <p className="monthly-paragraph monthly-note">Balances and credits are current as of preparation; historical December 31 balances cannot be verified. Individual homeowner details are withheld.</p>
        </Section>
        <Section title="3. Community Activities">
          {activities.length > 0 ? <Table headings={['Date','Event','Location']}
            rows={activities.map((e) => [formatDateOnly(e.event_date),e.title,e.location || '--'])}/>
            : <p className="monthly-paragraph monthly-note">No community events were recorded for this year.</p>}
        </Section>
        <Section title="4. Documents and Supporting Information">
          {docs.length > 0 ? <Table headings={['Document','Category','Date added']}
            rows={docs.map((d) => [d.title,d.category,formatReportDate(d.created_at)])}/>
            : <p className="monthly-paragraph monthly-note">No documents were added to the library during this year.</p>}
        </Section>
        <Section title="5. Grievances">
          <Table headings={['Measure','Cases']} rightCols={[1]} rows={grievanceRows(report.grievances)}/>
          <p className="monthly-paragraph monthly-note">{grievanceNote(report.grievances)}</p>
        </Section>
        <Section title="6. Scope of This Report"><p className="monthly-paragraph">{report.narrative.scope}</p></Section>
        <Section title="7. Management Commentary">
          <p className="monthly-paragraph">{report.narrative.commentary}</p>
          <h3 className="monthly-subheading">Basis of preparation</h3>
          <p className="monthly-paragraph monthly-note">{report.narrative.basis}</p>
        </Section>
        <div className="report-signatures">
          <div className="report-signature"><span className="report-signature-rule"/><strong>Prepared by</strong><span>HOA Management</span><span className="report-signature-date">Date:</span></div>
          <div className="report-signature"><span className="report-signature-rule"/><strong>Reviewed and approved by</strong><span className="report-signature-muted">Name and position</span><span className="report-signature-date">Date:</span></div>
        </div>
      </main>}
  </div>
}
