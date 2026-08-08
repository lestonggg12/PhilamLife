import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchLedgerAccounts } from '../lib/hoaLedger'
import { computeMonthlyReportData } from '../lib/monthlyReportData'
import { buildMonthlyReportPdf } from '../lib/monthlyReportPdf'
import { useOrganization } from '../context/OrganizationContext'
import { formatDate as formatDateValue } from '../config/organization'
import './ReportsPage.css'

const pesoNumber = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (value) => `PHP ${pesoNumber.format(Number(value || 0))}`

const monthLabelFormat = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' })


const todayInManila = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
const currentMonthInManila = () => todayInManila().slice(0, 7)
const monthName = (month) => monthLabelFormat.format(new Date(`${month}-15T12:00:00+08:00`))
const shortDate = (iso, dateFormat) => formatDateValue(iso, { dateFormat })

function ReportsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  )
}

function KpiCard({ label, value, tone }) {
  return (
    <div className={`monthly-kpi-card tone-${tone || 'default'}`}>
      <span className="monthly-kpi-label">{label}</span>
      <strong className="monthly-kpi-value">{value}</strong>
    </div>
  )
}

function SimpleTable({ head, rows, boldLastRow }) {
  return (
    <div className="reports-table-wrap">
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={boldLastRow && i === rows.length - 1 ? 'monthly-row-bold' : ''}>
              {row.map((cell, j) => <td key={j}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ num, title, children }) {
  return (
    <section className="monthly-section">
      <h2 className="monthly-section-title"><span>{num}.</span> {title}</h2>
      {children}
    </section>
  )
}

export default function ReportsPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [month, setMonth] = useState(currentMonthInManila())
  const [payments, setPayments] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [expenses, setExpenses] = useState([])
  const [ledgerAccounts, setLedgerAccounts] = useState([])
  const [documents, setDocuments] = useState([])
  const [events, setEvents] = useState([])
  const [orgSettings, setOrgSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pdfGenerating, setPdfGenerating] = useState(false)

  const role = currentUser?.role?.trim().toLowerCase()
  const canGenerateReports = role === 'admin' || role === 'treasurer'

  useEffect(() => {
    loadReports()
    resolveCurrentUser()
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

  async function loadReports() {
    setLoading(true)
    setError('')

    const [paymentResult, serviceResult, expenseResult, accountResult, settingsResult, documentResult, eventResult] = await Promise.all([
      supabase
        .from('payments')
        .select('id, receipt_number, homeowner_name, block_name, lot_number, coverage_period, amount_paid, remaining_balance, payment_method, paid_at, status')
        .neq('status', 'Voided')
        .order('paid_at', { ascending: false }),
      supabase
        .from('service_transactions')
        .select('id, receipt_number, customer_name, block_name, lot_number, service_name, amount_paid, payment_method, paid_at')
        .order('paid_at', { ascending: false }),
      supabase
        .from('expenses')
        .select('id, expense_date, category, description, amount, reference_number, recorded_by_name, status, created_at')
        .neq('status', 'Voided')
        .order('expense_date', { ascending: false }),
      fetchLedgerAccounts().then((data) => ({ data, error: null })).catch((loadError) => ({ data: [], error: loadError })),
      supabase.from('system_settings').select('hoa_name, address, contact_email, contact_phone, currency').eq('id', 1).maybeSingle(),
      supabase.from('documents').select('id, title, category, created_at').order('created_at', { ascending: false }),
      supabase.from('events').select('id, title, description, event_date, location').order('event_date', { ascending: true }),
    ])

    const loadError = paymentResult.error || serviceResult.error || expenseResult.error || accountResult.error
    if (loadError) setError(loadError.message)
    if (!paymentResult.error) setPayments(paymentResult.data || [])
    if (!serviceResult.error) setServiceTransactions(serviceResult.data || [])
    if (!expenseResult.error) setExpenses(expenseResult.data || [])
    if (!accountResult.error) setLedgerAccounts(accountResult.data || [])
    if (!settingsResult.error) setOrgSettings(settingsResult.data || null)
    if (!documentResult.error) setDocuments(documentResult.data || [])
    if (!eventResult.error) setEvents(eventResult.data || [])
    setLoading(false)
  }

  const report = useMemo(
    () => computeMonthlyReportData({ payments, serviceTransactions, expenses, ledgerAccounts, documents, events, month }),
    [payments, serviceTransactions, expenses, ledgerAccounts, documents, events, month]
  )

  async function downloadPdf() {
    setPdfGenerating(true)
    try {
      const doc = buildMonthlyReportPdf({
        monthLabel: monthName(month),
        hoaName: orgSettings?.hoa_name || 'Homeowners Association',
        hoaAddress: orgSettings?.address || '',
        preparedBy: currentUser?.full_name || 'HOA Management',
        datePrepared: organization.formatDate(new Date()),
        payments,
        serviceTransactions,
        expenses,
        ledgerAccounts,
        documents,
        events,
        month,
      })
      doc.save(`HOA-Monthly-Report-${month}.pdf`)
    } finally {
      setPdfGenerating(false)
    }
  }

  const { kpis } = report

  return (
    <div className="reports-page">
      <header className="reports-header no-print">
        <div className="reports-header-main">
          <div className="reports-header-icon"><ReportsIcon /></div>
          <div className="reports-header-text">
            <span className="reports-header-eyebrow">Finance Workspace</span>
            <h1>Monthly Report</h1>
            <p>Full HOA monthly report, viewable on screen and exportable as PDF.</p>
          </div>
        </div>
        <div className="reports-header-actions">
          <label className="monthly-month-picker">
            Report month
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          {canGenerateReports && (
            <button type="button" className="reports-primary" onClick={downloadPdf} disabled={loading || pdfGenerating}>
              {pdfGenerating ? 'Generating…' : 'Download PDF'}
            </button>
          )}
        </div>
      </header>

      {error && <p className="reports-error">Could not load reports: {error}</p>}

      {loading ? (
        <p className="reports-empty">Loading financial records...</p>
      ) : (
        <main className="monthly-report-doc">
          <div className="monthly-cover">
            <div className="monthly-cover-logo">HOA</div>
            <h1>Homeowners Association Monthly Report</h1>
            <p className="monthly-cover-period">{monthName(month)}</p>
            <p className="monthly-cover-org">{orgSettings?.hoa_name || 'Homeowners Association'}</p>
            {orgSettings?.address && <p className="monthly-cover-address">{orgSettings.address}</p>}
            <p className="monthly-cover-meta">Prepared by: {currentUser?.full_name || 'HOA Management'} · Date prepared: {organization.formatDate(new Date())}</p>
          </div>

          <Section num="1" title="Executive Summary">
            <div className="monthly-kpi-grid monthly-kpi-grid-4">
              <KpiCard label={`Total ${monthName(month).split(' ')[0]} Revenue`} value={money(kpis.totalIncome)} tone={kpis.totalIncome > 0 ? 'good' : 'default'} />
              <KpiCard label={`Total ${monthName(month).split(' ')[0]} Expenditures`} value={money(kpis.totalExpenses)} />
              <KpiCard label="Net Income / (Loss)" value={money(kpis.netIncome)} tone={kpis.netIncome >= 0 ? 'good' : 'bad'} />
              <KpiCard label="Outstanding Homeowner Balances" value={money(kpis.totalOutstanding)} tone={kpis.totalOutstanding > 0 ? 'warn' : 'good'} />
            </div>

            <h3 className="monthly-subheading">Narrative Summary</h3>
            <p className="monthly-paragraph">
              Total income of {money(kpis.totalIncome)} was recorded against total expenses of {money(kpis.totalExpenses)}, resulting in a net
              {' '}{kpis.netIncome >= 0 ? 'surplus' : 'deficit'} of {money(Math.abs(kpis.netIncome))} for the period. Outstanding homeowner balances
              {' '}across the community total {money(kpis.totalOutstanding)} as of report date. {report.events.thisMonth.length} community event(s)
              {' '}were held during the period.
            </p>
          </Section>

          <Section num="2" title="Financial Report">
            <h3 className="monthly-subheading">2.1 Income</h3>
            <SimpleTable
              head={['Revenue Category', 'Amount']}
              boldLastRow
              rows={[
                ['Homeowner Assessments (Dues)', money(report.income.duesIncome)],
                ...report.income.serviceByName.map((s) => [`Amenity / Service — ${s.name}`, money(s.amount)]),
                ['Total Income', money(report.income.totalIncome)],
              ]}
            />

            <h3 className="monthly-subheading">2.2 Expenses</h3>
            <p className="monthly-paragraph monthly-note">
              {report.expenses.entryCount} expense{report.expenses.entryCount === 1 ? '' : 's'} recorded this period.
            </p>

            {report.expenses.byCategory.length > 0 ? (
              <SimpleTable
                head={['Category', 'Entries', 'Amount']}
                boldLastRow
                rows={[
                  ...report.expenses.byCategory.map((c) => [c.category, String(c.count), money(c.amount)]),
                  ['Total Expenses', String(report.expenses.entryCount), money(report.expenses.totalExpenses)],
                ]}
              />
            ) : (
              <p className="monthly-paragraph monthly-note">No expenses recorded this period.</p>
            )}

            {report.expenses.entries.length > 0 && (
              <>
                <h4 className="monthly-subheading monthly-subheading-sm">Expense Detail</h4>
                <SimpleTable
                  head={['Date', 'Category', 'Description', 'Reference No.', 'Recorded By', 'Amount']}
                  rows={report.expenses.entries.map((e) => [
                    shortDate(`${e.expense_date}T12:00:00+08:00`, organization.dateFormat),
                    e.category,
                    e.description || '—',
                    e.reference_number || '—',
                    e.recorded_by_name || '—',
                    money(e.amount),
                  ])}
                />
              </>
            )}

            <p className="monthly-total-line">Total Expenses for {monthName(month)}: <strong>{money(report.expenses.totalExpenses)}</strong></p>

            <h3 className="monthly-subheading">2.3 Accounts Receivable & Collections</h3>
            <SimpleTable head={['Metric', 'Value']} rows={[
              ['Dues collected this period', money(report.receivables.duesIncome)],
              ['Amenity / service revenue collected this period', money(report.receivables.serviceIncome)],
              ['Outstanding homeowner balances (aggregate, as of report date)', money(report.receivables.totalOutstanding)],
              ['Number of accounts with an outstanding balance', String(report.receivables.outstandingAccountCount)],
            ]} />
            <p className="monthly-paragraph monthly-note">Aggregate figures only — individual homeowner names and balances are withheld from this general report.</p>
          </Section>

          <Section num="3" title="Community Activities">
            {report.events.thisMonth.length > 0 ? (
              <SimpleTable
                head={['Date', 'Event', 'Location']}
                rows={report.events.thisMonth.map((e) => [shortDate(`${e.event_date}T12:00:00+08:00`, organization.dateFormat), e.title, e.location || '—'])}
              />
            ) : (
              <p className="monthly-paragraph monthly-note">No community events were held during this period.</p>
            )}

            {report.events.upcoming.length > 0 && (
              <>
                <h3 className="monthly-subheading">Upcoming Events</h3>
                <SimpleTable
                  head={['Date', 'Event', 'Location']}
                  rows={report.events.upcoming.map((e) => [shortDate(`${e.event_date}T12:00:00+08:00`, organization.dateFormat), e.title, e.location || '—'])}
                />
              </>
            )}
          </Section>

          <Section num="4" title="Documents & Supporting Information">
            {report.documents.thisMonth.length > 0 ? (
              <SimpleTable
                head={['Document', 'Category', 'Date Added']}
                rows={report.documents.thisMonth.map((d) => [d.title, d.category, shortDate(d.created_at, organization.dateFormat)])}
              />
            ) : (
              <p className="monthly-paragraph monthly-note">No documents were added to the library during this period.</p>
            )}
          </Section>

          <section className="monthly-section">
            <h2 className="monthly-section-title"><span>5.</span> Items Not Yet Tracked in the System</h2>
            <p className="monthly-paragraph monthly-note">
              The following report areas require modules not yet built into PhilamLife, and are intentionally omitted above rather than shown with
              {' '}placeholder figures: {report.untrackedModules.join(', ')}.
            </p>
          </section>

          <Section num="6" title="Final Management Commentary">
            <p className="monthly-paragraph">
              The association recorded {money(kpis.totalIncome)} in income against {money(kpis.totalExpenses)} in expenses this period, a net
              {' '}{kpis.netIncome >= 0 ? 'surplus' : 'deficit'} of {money(Math.abs(kpis.netIncome))}. Outstanding homeowner balances stand at{' '}
              {money(kpis.totalOutstanding)}. Community activity on record for the period totals {report.events.thisMonth.length} event(s).
            </p>
          </Section>

          <footer className="report-footer">
            This report is prepared for informational purposes only, based solely on records available in the PhilamLife system as of the date
            prepared. No figures have been estimated or fabricated.
          </footer>

          <div className="report-signatures">
            <div className="report-signature-line">
              <span className="report-signature-blank" />
              <span className="report-signature-label">Prepared by{currentUser?.full_name ? ` — ${currentUser.full_name}` : ''}</span>
            </div>
            <div className="report-signature-line">
              <span className="report-signature-blank" />
              <span className="report-signature-label">Reviewed / Approved by</span>
            </div>
          </div>
        </main>
      )}
    </div>
  )
}