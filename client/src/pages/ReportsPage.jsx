import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import {
  collectionsRows,
  computeMonthlyReportData,
  formatDateOnly,
  formatLongDate,
  formatMoney as money,
  formatReportDate,
  incomeTableRows,
  monthBounds,
  monthTitle as monthName,
  periodLabel,
  reportText,
} from '../lib/monthlyReportData'
import { buildMonthlyReportPdf } from '../lib/monthlyReportPdf'
import './ReportsPage.css'

const todayInManila = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
const currentMonthInManila = () => todayInManila().slice(0, 7)

// ---------------------------------------------------------------------------
// Pure fetchers. They never touch React state, so the PDF download can pull a
// brand-new copy of every record instead of trusting whatever was loaded when
// the page opened.
// ---------------------------------------------------------------------------
async function fetchCommunity() {
  const [propertyResult, settingsResult, chargesResult] = await Promise.all([
    fetchAll(() => supabase.from('properties').select('id, homeowner_status, current_balance')),
    supabase.from('system_settings').select('hoa_name, address, contact_email, contact_phone, currency, dues_amount, due_day, grace_period_days, late_penalty').eq('id', 1).maybeSingle(),
    fetchAll(() => supabase.from('property_charges').select('property_id, amount, billing_month, created_at, charge_type').is('voided_at', null)),
  ])
  const failure = propertyResult.error || chargesResult.error || settingsResult.error
  return {
    failure: failure ? failure.message : '',
    properties: propertyResult.error ? null : propertyResult.data || [],
    charges: chargesResult.error ? null : chargesResult.data || [],
    settings: settingsResult.error ? null : settingsResult.data || null,
    settingsLoaded: !settingsResult.error,
  }
}

async function fetchMonth(selectedMonth) {
  const range = monthBounds(selectedMonth)
  const monthStartDate = range.start.slice(0, 10)
  const monthEndDate = range.end.slice(0, 10)

  const [paymentResult, serviceResult, expenseResult, documentResult, eventResult, upcomingResult] = await Promise.all([
    fetchAll(() => supabase
      .from('payments')
      // charge_type tells the report whether a payment was dues or a fee.
      .select('id, property_id, receipt_number, homeowner_name, block_name, lot_number, coverage_period, charge_type, amount, amount_paid, remaining_balance, payment_method, paid_at, status')
      .neq('status', 'Voided')
      .gte('paid_at', range.start)
      .lt('paid_at', range.end)
      .order('paid_at', { ascending: false })),
    fetchAll(() => supabase
      .from('service_transactions')
      .select('id, receipt_number, customer_name, block_name, lot_number, service_name, amount_paid, payment_method, paid_at, payment_status')
      .neq('payment_status', 'voided')
      .gte('paid_at', range.start)
      .lt('paid_at', range.end)
      .order('paid_at', { ascending: false })),
    fetchAll(() => supabase
      .from('expenses')
      .select('id, expense_date, category, description, amount, reference_number, recorded_by_name, status, created_at')
      .neq('status', 'Voided')
      .gte('expense_date', monthStartDate)
      .lt('expense_date', monthEndDate)
      .order('expense_date', { ascending: false })),
    fetchAll(() => supabase
      .from('documents')
      .select('id, title, category, created_at')
      .gte('created_at', range.start)
      .lt('created_at', range.end)
      .order('created_at', { ascending: false })),
    fetchAll(() => supabase
      .from('events')
      .select('id, title, description, event_date, location')
      .gte('event_date', monthStartDate)
      .lt('event_date', monthEndDate)
      .order('event_date', { ascending: true })),
    supabase
      .from('events')
      .select('id, title, description, event_date, location')
      .gte('event_date', monthEndDate)
      .order('event_date', { ascending: true })
      .limit(6),
  ])

  // The upcoming-events query is part of the report too, so its failure counts.
  const failure = paymentResult.error || serviceResult.error || expenseResult.error || documentResult.error || eventResult.error || upcomingResult.error
  return {
    failure: failure ? failure.message : '',
    payments: paymentResult.error ? [] : paymentResult.data || [],
    serviceTransactions: serviceResult.error ? [] : serviceResult.data || [],
    expenses: expenseResult.error ? [] : expenseResult.data || [],
    documents: documentResult.error ? [] : documentResult.data || [],
    events: [
      ...(eventResult.error ? [] : eventResult.data || []),
      ...(upcomingResult.error ? [] : upcomingResult.data || []),
    ],
  }
}

function ReportsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  )
}

function KeyFigure({ label, value, alert }) {
  return (
    <div className="monthly-figure">
      <span className="monthly-figure-label">{label}</span>
      <strong className={`monthly-figure-value${alert ? ' is-alert' : ''}`}>{value}</strong>
    </div>
  )
}

function SimpleTable({ head, rows, totalRow, rightCols = [] }) {
  const align = (i) => (rightCols.includes(i) ? 'is-right' : undefined)
  return (
    <div className="reports-table-wrap">
      <table data-column-count={head.length}>
        <thead><tr>{head.map((h, i) => <th key={h} className={align(i)}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={totalRow && i === rows.length - 1 ? 'monthly-row-total' : ''}>
              {row.map((cell, j) => <td key={j} className={align(j)}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="monthly-section">
      <h2 className="monthly-section-title">{title}</h2>
      {children}
    </section>
  )
}

export default function ReportsPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [month, setMonth] = useState(currentMonthInManila())
  const [payments, setPayments] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [expenses, setExpenses] = useState([])
  const [properties, setProperties] = useState([])
  const [charges, setCharges] = useState([])
  const [documents, setDocuments] = useState([])
  const [events, setEvents] = useState([])
  const [orgSettings, setOrgSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [communityError, setCommunityError] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)
  const monthLoadToken = useRef(0)
  const monthRef = useRef(month)
  monthRef.current = month

  const role = currentUser?.role?.trim().toLowerCase()
  const canGenerateReports = role === 'admin' || role === 'treasurer'

  // Community-wide data (balances, charges, settings) loads on open.
  useEffect(() => {
    loadCommunityData()
    resolveCurrentUser()
  }, [])

  // Everything dated (payments, services, expenses, documents, events) loads for
  // the selected month only, so the report stays fast no matter how many years of
  // history exist.
  useEffect(() => {
    loadMonthData(month)
  }, [month])

  // Coming back to this tab after recording a payment or expense elsewhere
  // refreshes the figures quietly (no loading flash).
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      loadCommunityData()
      loadMonthData(monthRef.current, { silent: true })
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !authUser) return
    const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', authUser.id).single()
    if (!profileError) setCurrentUser(profile)
  }

  function applyCommunity(result) {
    setCommunityError(result.failure)
    if (result.properties) setProperties(result.properties)
    if (result.charges) setCharges(result.charges)
    if (result.settingsLoaded) setOrgSettings(result.settings)
  }

  function applyMonth(result) {
    setError(result.failure)
    setPayments(result.payments)
    setServiceTransactions(result.serviceTransactions)
    setExpenses(result.expenses)
    setDocuments(result.documents)
    setEvents(result.events)
  }

  async function loadCommunityData() {
    applyCommunity(await fetchCommunity())
  }

  async function loadMonthData(selectedMonth, { silent = false } = {}) {
    // If the month is changed again while this is loading, ignore the older answer.
    const token = (monthLoadToken.current += 1)
    if (!silent) {
      setLoading(true)
      setError('')
    }
    const result = await fetchMonth(selectedMonth)
    if (token !== monthLoadToken.current) return
    applyMonth(result)
    setLoading(false)
  }

  const report = useMemo(
    () => computeMonthlyReportData({ payments, serviceTransactions, expenses, properties, charges, settings: orgSettings, documents, events, month }),
    [payments, serviceTransactions, expenses, properties, charges, orgSettings, documents, events, month]
  )

  const loadFailure = error || communityError

  async function downloadPdf() {
    if (pdfGenerating) return
    setPdfGenerating(true)
    // Invalidate any load still in flight so it cannot overwrite the fresh copy.
    monthLoadToken.current += 1
    try {
      // Always rebuild from a fresh read of the database, never from state
      // that may be minutes old.
      const [community, monthly] = await Promise.all([fetchCommunity(), fetchMonth(month)])
      applyCommunity(community)
      applyMonth(monthly)
      setLoading(false)
      if (community.failure || monthly.failure) return

      const doc = buildMonthlyReportPdf({
        monthLabel: monthName(month),
        hoaName: community.settings?.hoa_name || 'Homeowners Association',
        hoaAddress: community.settings?.address || '',
        preparedBy: currentUser?.full_name || 'HOA Management',
        datePrepared: formatLongDate(new Date()),
        payments: monthly.payments,
        serviceTransactions: monthly.serviceTransactions,
        expenses: monthly.expenses,
        properties: community.properties,
        charges: community.charges,
        settings: community.settings,
        documents: monthly.documents,
        events: monthly.events,
        month,
      })
      doc.save(`HOA-Monthly-Report-${month}.pdf`)
    } finally {
      setPdfGenerating(false)
    }
  }

  const { kpis } = report
  const monthLabel = monthName(month)
  const datePrepared = formatLongDate(new Date())
  const text = reportText(report, { monthLabel, datePrepared })
  const preparedBy = currentUser?.full_name || 'HOA Management'
  const hoaName = orgSettings?.hoa_name || 'Homeowners Association'
  const hoaShort = hoaName.replace(/\s*homeowners association\s*$/i, '').trim() || hoaName

  return (
    <div className="reports-page">
      <header className="reports-header no-print">
        <div className="reports-header-main">
          <div className="reports-header-icon"><ReportsIcon /></div>
          <div className="reports-header-text">
            <span className="reports-header-eyebrow">Finance Workspace</span>
            <h1>Monthly Management Report</h1>
            <p>Review the report on screen, then download the PDF for distribution.</p>
          </div>
        </div>
        <div className="reports-header-actions">
          <label className="monthly-month-picker">
            Report month
            <input type="month" value={month} disabled={pdfGenerating} onChange={(event) => setMonth(event.target.value)} />
          </label>
          {canGenerateReports && (
            <button type="button" className="reports-primary" onClick={downloadPdf} disabled={loading || pdfGenerating || Boolean(loadFailure)}>
              {pdfGenerating ? 'Preparing PDF…' : 'Download PDF'}
            </button>
          )}
        </div>
      </header>

      {loadFailure && <p className="reports-error">Could not load every record needed for this report ({loadFailure}). Totals may be incomplete, so PDF download is disabled until the data loads. Refresh the page to try again.</p>}

      {loading ? (
        <p className="reports-empty">Loading financial records...</p>
      ) : (
        <main className="monthly-report-doc">
          <div className="monthly-cover">
            <h1 className="monthly-cover-org">{hoaShort}</h1>
            <p className="monthly-cover-type">Homeowners Association</p>
            <hr className="monthly-cover-rule" />
            <p className="monthly-cover-label">Monthly Management Report</p>
            <p className="monthly-cover-period">{monthLabel}</p>
            {orgSettings?.address && <p className="monthly-cover-address">{orgSettings.address}</p>}
            <dl className="monthly-cover-details">
              <div><dt>Reporting period</dt><dd>{periodLabel(month)}</dd></div>
              <div><dt>Prepared by</dt><dd>{preparedBy}</dd></div>
              <div><dt>Date prepared</dt><dd>{datePrepared}</dd></div>
            </dl>
          </div>

          <Section title="1. Executive Summary">
            <div className="monthly-figure-band">
              <KeyFigure label="Total revenue" value={money(kpis.totalIncome)} />
              <KeyFigure label="Total expenditures" value={money(kpis.totalExpenses)} />
              <KeyFigure label={kpis.netIncome >= 0 ? 'Net surplus' : 'Net deficit'} value={money(Math.abs(kpis.netIncome))} alert={kpis.netIncome < 0} />
              <KeyFigure label="Outstanding balances" value={money(kpis.totalOutstanding)} />
            </div>
            <h3 className="monthly-subheading">Management overview</h3>
            <p className="monthly-paragraph">{text.overview}</p>
          </Section>

          <Section title="2. Financial Report">
            <h3 className="monthly-subheading">2.1 Income</h3>
            <SimpleTable head={['Revenue category', 'Amount']} rightCols={[1]} totalRow rows={incomeTableRows(report.income, money)} />

            <h3 className="monthly-subheading">2.2 Expenses</h3>
            <p className="monthly-paragraph monthly-note">{text.expenseIntro}</p>
            {report.expenses.byCategory.length > 0 && (
              <SimpleTable
                head={['Category', 'Entries', 'Amount']}
                rightCols={[1, 2]}
                totalRow
                rows={[
                  ...report.expenses.byCategory.map((c) => [c.category, String(c.count), money(c.amount)]),
                  ['Total expenses', String(report.expenses.entryCount), money(report.expenses.totalExpenses)],
                ]}
              />
            )}

            {report.expenses.entries.length > 0 && (
              <>
                <h3 className="monthly-subheading">Expense detail</h3>
                <SimpleTable
                  head={['Date', 'Category', 'Description', 'Ref. no.', 'Recorded by', 'Amount']}
                  rightCols={[5]}
                  rows={report.expenses.entries.map((e) => [
                    formatDateOnly(e.expense_date),
                    e.category,
                    e.description || '\u2014',
                    e.reference_number || '\u2014',
                    e.recorded_by_name || '\u2014',
                    money(e.amount),
                  ])}
                />
              </>
            )}

            <h3 className="monthly-subheading">2.3 Accounts Receivable and Collections</h3>
            <SimpleTable head={['Measure', 'Value']} rightCols={[1]} rows={collectionsRows(report.receivables)} />
            <p className="monthly-paragraph monthly-note">Aggregate figures only. Individual homeowner names and balances are withheld from this report.</p>
          </Section>

          <Section title="3. Community Activities">
            {report.events.thisMonth.length > 0 ? (
              <SimpleTable
                head={['Date', 'Event', 'Location']}
                rows={report.events.thisMonth.map((e) => [formatDateOnly(e.event_date), e.title, e.location || '\u2014'])}
              />
            ) : (
              <p className="monthly-paragraph monthly-note">No community events were recorded for this period.</p>
            )}
            {report.events.upcoming.length > 0 && (
              <>
                <h3 className="monthly-subheading">Upcoming events</h3>
                <SimpleTable
                  head={['Date', 'Event', 'Location']}
                  rows={report.events.upcoming.map((e) => [formatDateOnly(e.event_date), e.title, e.location || '\u2014'])}
                />
              </>
            )}
          </Section>

          <Section title="4. Documents and Supporting Information">
            {report.documents.thisMonth.length > 0 ? (
              <SimpleTable
                head={['Document', 'Category', 'Date added']}
                rows={report.documents.thisMonth.map((d) => [d.title, d.category, formatReportDate(d.created_at)])}
              />
            ) : (
              <p className="monthly-paragraph monthly-note">No documents were added to the library during this period.</p>
            )}
          </Section>

          <Section title="5. Scope of This Report">
            <p className="monthly-paragraph">{text.scope}</p>
          </Section>

          <Section title="6. Management Commentary">
            <p className="monthly-paragraph">{text.commentary}</p>
            <h3 className="monthly-subheading">Basis of preparation</h3>
            <p className="monthly-paragraph monthly-note">{text.basis}</p>
          </Section>

          <div className="report-signatures">
            <div className="report-signature">
              <span className="report-signature-rule" />
              <strong>Prepared by</strong>
              <span>{preparedBy}</span>
              <span className="report-signature-date">Date:</span>
            </div>
            <div className="report-signature">
              <span className="report-signature-rule" />
              <strong>Reviewed and approved by</strong>
              <span className="report-signature-muted">Name and position</span>
              <span className="report-signature-date">Date:</span>
            </div>
          </div>
        </main>
      )}
    </div>
  )
}