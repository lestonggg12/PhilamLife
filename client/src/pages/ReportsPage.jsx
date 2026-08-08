import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchLedgerAccounts } from '../lib/hoaLedger'
import { buildMonthlyReportPdf } from '../lib/monthlyReportPdf'
import './ReportsPage.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
})

const pesoOrNA = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? 'N/A' : peso.format(Number(value))

const pctOrNA = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? 'N/A' : `${Number(value).toFixed(1)}%`

const NA = 'N/A'

const monthLabel = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const dateLabel = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const shortDateLabel = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const todayInManila = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

const currentMonthInManila = () => todayInManila().slice(0, 7)

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
    startMs: new Date(`${month}-01T00:00:00+08:00`).getTime(),
    endMs: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`).getTime(),
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

function SectionHeading({ number, title }) {
  return (
    <div className="mreport-section-heading">
      <h2>{number}. {title}</h2>
    </div>
  )
}

function KpiCard({ label, value, tone = 'default' }) {
  return (
    <div className={`mreport-kpi mreport-kpi-${tone}`}>
      <span className="mreport-kpi-label">{label}</span>
      <strong className="mreport-kpi-value">{value}</strong>
    </div>
  )
}

function DataTable({ head, rows, boldLastRow = false, emptyLabel = 'No records for this period.' }) {
  return (
    <div className="mreport-table-wrap">
      <table>
        <thead>
          <tr>{head.map((h) => <th key={h} className={h.numeric ? 'number' : ''}>{h.label || h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={boldLastRow && rowIndex === rows.length - 1 ? 'mreport-row-bold' : ''}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={typeof cell === 'string' && (cell.startsWith('₱') || cell === 'N/A') && cellIndex > 0 ? 'number' : ''}>
                  {cell}
                </td>
              ))}
            </tr>
          )) : (
            <tr><td colSpan={head.length} className="mreport-empty">{emptyLabel}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function ReportsPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [selectedMonth, setSelectedMonth] = useState(currentMonthInManila())
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
  const [pdfError, setPdfError] = useState('')

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

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadReports() {
    setLoading(true)
    setError('')

    const [paymentResult, serviceResult, expenseResult, accountResult, settingsResult, documentResult, eventResult] = await Promise.all([
      supabase
        .from('payments')
        .select('id, receipt_number, homeowner_name, block_name, lot_number, coverage_period, amount_paid, remaining_balance, payment_method, paid_at, status')
        .order('paid_at', { ascending: false }),
      supabase
        .from('service_transactions')
        .select('id, receipt_number, customer_name, block_name, lot_number, service_name, amount_paid, payment_method, paid_at')
        .order('paid_at', { ascending: false }),
      supabase
        .from('expenses')
        .select('id, expense_date, category, description, amount, reference_number, recorded_by_name, status, created_at')
        .order('expense_date', { ascending: false }),
      fetchLedgerAccounts()
        .then((data) => ({ data, error: null }))
        .catch((loadError) => ({ data: [], error: loadError })),
      supabase
        .from('system_settings')
        .select('hoa_name, address, contact_email, contact_phone, currency')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('documents')
        .select('id, title, category, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('events')
        .select('id, title, description, event_date, location')
        .order('event_date', { ascending: true }),
    ])

    const loadError = paymentResult.error || serviceResult.error || expenseResult.error || accountResult.error
    if (loadError) {
      setError(loadError.message)
    }
    if (!paymentResult.error) setPayments(paymentResult.data || [])
    if (!serviceResult.error) setServiceTransactions(serviceResult.data || [])
    if (!expenseResult.error) setExpenses(expenseResult.data || [])
    if (!accountResult.error) setLedgerAccounts(accountResult.data || [])
    if (!settingsResult.error) setOrgSettings(settingsResult.data || null)
    if (!documentResult.error) setDocuments(documentResult.data || [])
    if (!eventResult.error) setEvents(eventResult.data || [])
    setLoading(false)
  }

  const validPayments = useMemo(() => payments.filter((p) => p.status !== 'Voided'), [payments])
  const activeExpenses = useMemo(() => expenses.filter((e) => e.status !== 'Voided'), [expenses])

  const bounds = useMemo(() => monthBounds(selectedMonth), [selectedMonth])
  const inRange = (iso) => {
    if (!iso) return false
    const ms = new Date(iso).getTime()
    return ms >= bounds.startMs && ms < bounds.endMs
  }

  const monthlyDues = useMemo(() => validPayments.filter((p) => inRange(p.paid_at)), [validPayments, bounds])
  const monthlyServices = useMemo(() => serviceTransactions.filter((t) => inRange(t.paid_at)), [serviceTransactions, bounds])
  const monthlyExpenses = useMemo(
    () => activeExpenses.filter((e) => inRange(`${e.expense_date}T12:00:00+08:00`)),
    [activeExpenses, bounds]
  )

  const duesIncome = monthlyDues.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
  const serviceIncome = monthlyServices.reduce((s, t) => s + Number(t.amount_paid || 0), 0)
  const totalIncome = duesIncome + serviceIncome
  const totalExpenses = monthlyExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const netIncome = totalIncome - totalExpenses

  const outstandingAccounts = useMemo(() => ledgerAccounts.filter((a) => Number(a.balance) > 0).sort((a, b) => b.balance - a.balance), [ledgerAccounts])
  const totalOutstanding = outstandingAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)

  const allTimeCharged = ledgerAccounts.reduce((s, a) => s + Number(a.totalCharges || 0), 0)
  const allTimeCollected = ledgerAccounts.reduce((s, a) => s + Number(a.totalPaid || 0), 0)
  // Collection rate is only meaningful once assessed charges are tracked
  // per-property (homeowner_charges). While that ledger is empty/incomplete,
  // total_assessed under-reports real charges and the ratio can exceed
  // 100% — that's a data-completeness gap, not a real rate, so it's
  // reported as N/A instead of a misleading number.
  const rawCollectionRate = allTimeCharged > 0 ? (allTimeCollected / allTimeCharged) * 100 : null
  const overallCollectionRate = rawCollectionRate !== null && rawCollectionRate <= 100 ? rawCollectionRate : null

  const expenseByCategory = useMemo(() => {
    const totals = new Map()
    monthlyExpenses.forEach((e) => {
      const cat = e.category || 'Uncategorized'
      totals.set(cat, (totals.get(cat) || 0) + Number(e.amount || 0))
    })
    return totals
  }, [monthlyExpenses])

  const serviceByName = useMemo(() => {
    const totals = new Map()
    monthlyServices.forEach((t) => {
      const name = t.service_name || 'Other'
      totals.set(name, (totals.get(name) || 0) + Number(t.amount_paid || 0))
    })
    return totals
  }, [monthlyServices])

  const monthEvents = useMemo(() => events.filter((e) => inRange(`${e.event_date}T12:00:00+08:00`)), [events, bounds])
  const upcomingEvents = useMemo(
    () =>
      events
        .filter((e) => new Date(`${e.event_date}T00:00:00+08:00`).getTime() > bounds.endMs - 1)
        .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
        .slice(0, 6),
    [events, bounds]
  )
  const monthDocuments = useMemo(() => documents.filter((d) => inRange(d.created_at)), [documents, bounds])

  const selectedMonthName = monthLabel.format(new Date(`${selectedMonth}-15T12:00:00+08:00`))

  // ---------- Section 2 table rows ----------
  const incomeRows = [
    ['Homeowner Assessments (Dues)', NA, pesoOrNA(duesIncome), NA],
    ...Array.from(serviceByName.entries()).map(([name, amt]) => [`Amenity / Service — ${name}`, NA, pesoOrNA(amt), NA]),
    ['Late Fees', NA, NA, NA],
    ['Fines / Penalties', NA, NA, NA],
    ['Other Income', NA, NA, NA],
    ['Total Income', NA, pesoOrNA(totalIncome), NA],
  ]

  const expenseCategoryOrder = ['Landscaping', 'Security', 'Utilities', 'Repairs & Maintenance', 'Administrative', 'Insurance', 'Staff / Payroll']
  const seenCategories = new Set()
  const expenseRows = []
  expenseCategoryOrder.forEach((cat) => {
    if (expenseByCategory.has(cat)) {
      expenseRows.push([cat, NA, pesoOrNA(expenseByCategory.get(cat)), NA])
      seenCategories.add(cat)
    }
  })
  expenseByCategory.forEach((amt, cat) => {
    if (!seenCategories.has(cat)) expenseRows.push([cat, NA, pesoOrNA(amt), NA])
  })
  if (expenseRows.length === 0) expenseRows.push(['No expense records for this period', NA, pesoOrNA(0), NA])
  expenseRows.push(['Total Expenses', NA, pesoOrNA(totalExpenses), NA])

  async function handleDownloadPdf() {
    setPdfError('')
    setPdfGenerating(true)
    try {
      const doc = buildMonthlyReportPdf({
        monthLabel: selectedMonthName,
        hoaName: orgSettings?.hoa_name || 'Homeowners Association',
        hoaAddress: orgSettings?.address || '',
        preparedBy: currentUser?.full_name || 'HOA Management',
        datePrepared: dateLabel.format(new Date()),
        payments: validPayments,
        serviceTransactions,
        expenses: activeExpenses,
        ledgerAccounts,
        documents,
        events,
        monthRange: { startMs: bounds.startMs, endMs: bounds.endMs },
      })
      doc.save(`HOA-Monthly-Report-${selectedMonth}.pdf`)
    } catch (pdfBuildError) {
      setPdfError(pdfBuildError?.message || 'Could not generate the PDF report.')
    } finally {
      setPdfGenerating(false)
    }
  }

  return (
    <div className="reports-page">
      <header className="reports-header no-print">
        <div className="reports-header-main">
          <div className="reports-header-icon">
            <ReportsIcon />
          </div>
          <div className="reports-header-text">
            <span className="reports-header-eyebrow">Finance Workspace</span>
            <h1>Monthly Report</h1>
            <p>A digital, per-month view of the same HOA Monthly Report generated as a PDF.</p>
          </div>
        </div>
        <div className="reports-header-actions">
          <label className="mreport-month-picker">
            Month
            <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
          </label>
          {canGenerateReports && (
            <button type="button" className="reports-primary" onClick={handleDownloadPdf} disabled={loading || pdfGenerating}>
              {pdfGenerating ? 'Generating…' : 'Download PDF'}
            </button>
          )}
        </div>
      </header>

      {error && <p className="reports-error">Could not load reports: {error}</p>}
      {pdfError && <p className="reports-error">{pdfError}</p>}

      {loading ? (
        <p className="reports-empty">Loading financial records...</p>
      ) : (
        <main className="mreport">
          <div className="mreport-letterhead">
            <div>
              <p className="mreport-letterhead-org">{orgSettings?.hoa_name || 'Homeowners Association'}</p>
              {orgSettings?.address && <p className="mreport-letterhead-address">{orgSettings.address}</p>}
              {(orgSettings?.contact_email || orgSettings?.contact_phone) && (
                <p className="mreport-letterhead-contact">
                  {[orgSettings?.contact_email, orgSettings?.contact_phone].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <div className="mreport-letterhead-meta">
              <p className="mreport-letterhead-title">Monthly Report — {selectedMonthName}</p>
              <p>Prepared by: {currentUser?.full_name || 'HOA Management'}</p>
              <p>Date prepared: {dateLabel.format(new Date())}</p>
            </div>
          </div>

          {/* 1. Executive Summary */}
          <section className="mreport-section">
            <SectionHeading number={1} title="Executive Summary" />
            <div className="mreport-kpi-grid">
              <KpiCard label="Total Monthly Income" value={pesoOrNA(totalIncome)} tone={totalIncome > 0 ? 'good' : 'default'} />
              <KpiCard label="Total Monthly Expenses" value={pesoOrNA(totalExpenses)} />
              <KpiCard label="Net Income / (Loss)" value={pesoOrNA(netIncome)} tone={netIncome >= 0 ? 'good' : 'bad'} />
              <KpiCard label="Current Cash Balance" value={NA} />
              <KpiCard label="Reserve Fund Balance" value={NA} />
              <KpiCard label="Assessment Collection Rate (to date)" value={pctOrNA(overallCollectionRate)} />
              <KpiCard label="Outstanding Homeowner Balances" value={pesoOrNA(totalOutstanding)} tone={totalOutstanding > 0 ? 'warn' : 'good'} />
              <KpiCard label="Open Maintenance Requests" value={NA} />
              <KpiCard label="Open Violations" value={NA} />
            </div>
            <h3 className="mreport-subheading">Narrative Summary</h3>
            <p className="mreport-paragraph">
              Overall financial condition: total income of {pesoOrNA(totalIncome)} was recorded against total expenses of{' '}
              {pesoOrNA(totalExpenses)}, resulting in a net {netIncome >= 0 ? 'surplus' : 'deficit'} of {pesoOrNA(Math.abs(netIncome))} for
              the period. Outstanding homeowner balances across the community total {pesoOrNA(totalOutstanding)} as of report date. Major
              operational activities, maintenance work, incidents, capital projects, and board decisions for the period are Not Available
              in the system and are marked accordingly throughout this report. Community events on record for the period: {monthEvents.length}.
            </p>
            <div className="mreport-legend">
              <p>Legend: <span className="mreport-legend-good">Green</span> = favorable / completed &nbsp; <span className="mreport-legend-warn">Amber</span> = attention required &nbsp; <span className="mreport-legend-bad">Red</span> = issue / overdue</p>
              <p>Sections without a corresponding data source in the system are marked &quot;N/A — Not Available&quot; rather than estimated.</p>
            </div>
          </section>

          {/* 2. Financial Report */}
          <section className="mreport-section">
            <SectionHeading number={2} title="Financial Report" />

            <h3 className="mreport-subheading">2.1 Income / Revenue</h3>
            <DataTable head={['Revenue Category', 'Budget', 'Actual', 'Variance']} rows={incomeRows} boldLastRow />

            <h3 className="mreport-subheading">2.2 Expenses</h3>
            <DataTable head={['Expense Category', 'Budget', 'Actual', 'Variance']} rows={expenseRows} boldLastRow />

            <h3 className="mreport-subheading">2.3 Budget vs. Actual</h3>
            <p className="mreport-paragraph mreport-paragraph-muted">
              No budget module is configured in the system, so budget figures and variances are shown as N/A. Actual income and expense
              totals above are drawn directly from posted transactions for the period.
            </p>

            <h3 className="mreport-subheading">2.4 Balance Sheet / Financial Position</h3>
            <DataTable head={['Assets', 'Amount']} rows={[
              ['Operating Cash', NA],
              ['Reserve Cash', NA],
              ['Accounts Receivable', pesoOrNA(totalOutstanding)],
              ['Other Assets', NA],
            ]} />
            <DataTable head={['Liabilities', 'Amount']} rows={[
              ['Accounts Payable', NA],
              ['Accrued Expenses', NA],
              ['Other Liabilities', NA],
            ]} />
            <DataTable head={['Fund Balances', 'Amount']} rows={[
              ['Operating Fund', NA],
              ['Reserve Fund', NA],
              ['Other Funds', NA],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              A full balance sheet requires opening bank balances and a general ledger close, which are not tracked in the current system.
            </p>

            <h3 className="mreport-subheading">2.5 Accounts Receivable / Collections</h3>
            <DataTable head={['Metric', 'Value']} rows={[
              ['Total assessments billed (all time)', pesoOrNA(allTimeCharged || null)],
              ['Total assessments collected (all time)', pesoOrNA(allTimeCollected || null)],
              ['Overall collection rate', pctOrNA(overallCollectionRate)],
              ['Outstanding homeowner balances (aggregate)', pesoOrNA(totalOutstanding)],
              ['Number of delinquent accounts', String(outstandingAccounts.length)],
              ['Amount collected this period (dues)', pesoOrNA(duesIncome)],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              Aggregate figures only — individual homeowner names and balances are withheld from this general report.
            </p>

            <h3 className="mreport-subheading">2.6 Reserve Fund</h3>
            <DataTable head={['Reserve Fund Activity', 'Amount']} rows={[
              ['Beginning Balance', NA],
              ['Monthly Contributions', NA],
              ['Interest / Other Income', NA],
              ['Withdrawals', NA],
              ['Ending Balance', NA],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              Reserve fund balances are not yet tracked separately in the system; a dedicated reserve ledger is needed to populate this
              section.
            </p>
          </section>

          {/* 3. Maintenance */}
          <section className="mreport-section">
            <SectionHeading number={3} title="Maintenance &amp; Facilities Report" />
            <DataTable head={['Metric', 'Value']} rows={[
              ['Total maintenance requests received', NA],
              ['Requests completed', NA],
              ['Requests still open', NA],
              ['Average resolution time', NA],
              ['Emergency repairs', NA],
              ['Routine maintenance', NA],
            ]} />
            <DataTable head={['Maintenance Item', 'Status', 'Cost', 'Date', 'Notes']} rows={[
              ['Not Available', 'Not Available', NA, NA, 'No maintenance-request module is currently connected to this report.'],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              This section will populate once a maintenance-request tracking module is added to the system.
            </p>
          </section>

          {/* 4. Administrative */}
          <section className="mreport-section">
            <SectionHeading number={4} title="Administrative &amp; Management Report" />
            <DataTable head={['Metric', 'Value']} rows={[
              ['Board meetings held', NA],
              ['Homeowner requests received', NA],
              ['Homeowner requests resolved', NA],
              ['Notices issued', NA],
              ['Contracts renewed', NA],
              ['Vendor changes', NA],
              ['Policies reviewed or updated', NA],
              ['Documents added to library this period', String(monthDocuments.length)],
              ['Community/board events on calendar this period', String(monthEvents.length)],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              Board-meeting and homeowner-request tracking are not yet captured as structured data in the system.
            </p>
          </section>

          {/* 5. Violations */}
          <section className="mreport-section">
            <SectionHeading number={5} title="Violations &amp; Compliance" />
            <DataTable head={['Category', 'New', 'Resolved', 'Outstanding']} rows={[
              ['Property Maintenance', NA, NA, NA],
              ['Parking', NA, NA, NA],
              ['Noise', NA, NA, NA],
              ['Architectural', NA, NA, NA],
              ['Other', NA, NA, NA],
            ]} />
            <DataTable head={['Metric', 'Value']} rows={[
              ['Fines assessed', NA],
              ['Fines collected', NA],
              ['Architectural applications approved', NA],
              ['Architectural applications pending', NA],
              ['Architectural applications rejected', NA],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              No violations/compliance module is currently connected to this report.
            </p>
          </section>

          {/* 6. Security */}
          <section className="mreport-section">
            <SectionHeading number={6} title="Security &amp; Incident Report" />
            <DataTable head={['Date', 'Incident Type', 'Location', 'Status', 'Action Taken']} rows={[
              [NA, 'Not Available', NA, NA, 'No security/incident tracking module is currently connected to this report.'],
            ]} />
          </section>

          {/* 7. Community Activities */}
          <section className="mreport-section">
            <SectionHeading number={7} title="Community Activities" />
            <DataTable
              head={['Date', 'Event', 'Location', 'Attendance']}
              rows={monthEvents.length
                ? monthEvents.map((e) => [shortDateLabel.format(new Date(`${e.event_date}T12:00:00+08:00`)), e.title, e.location || NA, NA])
                : []}
              emptyLabel="No community events on record for this period."
            />
            <h3 className="mreport-subheading">Upcoming Events</h3>
            <DataTable
              head={['Date', 'Event', 'Location']}
              rows={upcomingEvents.length
                ? upcomingEvents.map((e) => [shortDateLabel.format(new Date(`${e.event_date}T12:00:00+08:00`)), e.title, e.location || NA])
                : []}
              emptyLabel="No upcoming events on record."
            />
          </section>

          {/* 8. Capital Projects */}
          <section className="mreport-section">
            <SectionHeading number={8} title="Capital Projects" />
            <DataTable head={['Project', 'Budget', 'Spent', 'Progress', 'Status', 'Expected Completion']} rows={[
              ['Not Available', NA, NA, NA, NA, NA],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              No capital-projects module is currently connected to this report. Add project tracking to populate budgets, spend, and
              completion status here.
            </p>
          </section>

          {/* 9. KPIs */}
          <section className="mreport-section">
            <SectionHeading number={9} title="Key Performance Indicators" />
            <DataTable head={['KPI', 'Current Month', 'Previous Month', 'Change']} rows={[
              ['Assessment Collection Rate (to date)', pctOrNA(overallCollectionRate), NA, NA],
              ['Budget Utilization', NA, NA, NA],
              ['Maintenance Completion Rate', NA, NA, NA],
              ['Avg. Maintenance Resolution Time', NA, NA, NA],
              ['Open Violations', NA, NA, NA],
              ['Open Maintenance Requests', NA, NA, NA],
              ['Reserve Fund Balance', NA, NA, NA],
              ['Community Events Held', String(monthEvents.length), NA, NA],
              ['Homeowner Requests', NA, NA, NA],
            ]} />
            <p className="mreport-paragraph mreport-paragraph-muted">
              Month-over-month comparisons require the prior month's report data; only current-period figures available in the system
              are shown.
            </p>
          </section>

          {/* 10 & 11 */}
          <section className="mreport-section">
            <SectionHeading number={10} title="Board Action Items" />
            <DataTable head={['Action Item', 'Priority', 'Responsible Party', 'Due Date', 'Status']} rows={[
              ['Not Available', NA, NA, NA, NA],
            ]} />
          </section>

          <section className="mreport-section">
            <SectionHeading number={11} title="Upcoming Activities & Deadlines" />
            <DataTable
              head={['Date', 'Item', 'Type']}
              rows={upcomingEvents.length
                ? upcomingEvents.map((e) => [shortDateLabel.format(new Date(`${e.event_date}T12:00:00+08:00`)), e.title, 'Community Event'])
                : []}
              emptyLabel="No upcoming items on record."
            />
          </section>

          {/* 12. Documents */}
          <section className="mreport-section">
            <SectionHeading number={12} title="Documents & Supporting Information" />
            <DataTable
              head={['Document', 'Category', 'Date Added']}
              rows={monthDocuments.length
                ? monthDocuments.map((d) => [d.title, d.category, shortDateLabel.format(new Date(d.created_at))])
                : [
                    ['Monthly Financial Statement', 'Not Attached', ''],
                    ['Income & Expense Statement', 'Not Attached', ''],
                    ['Balance Sheet', 'Not Attached', ''],
                    ['Board Meeting Minutes', 'Not Attached', ''],
                  ]}
            />
          </section>

          {/* 13. Final Commentary */}
          <section className="mreport-section">
            <SectionHeading number={13} title="Final Management Commentary" />
            <p className="mreport-paragraph">
              Financial condition: the association recorded {pesoOrNA(totalIncome)} in income against {pesoOrNA(totalExpenses)} in
              expenses this period, a net {netIncome >= 0 ? 'surplus' : 'deficit'} of {pesoOrNA(Math.abs(netIncome))}. Outstanding
              homeowner balances stand at {pesoOrNA(totalOutstanding)}. Operational performance, maintenance condition, compliance
              situation, and major risks cannot be assessed from currently tracked data and are marked N/A above. Community activity on
              record for the period totals {monthEvents.length} event(s). Priorities for next month should include closing the data gaps
              noted throughout this report (maintenance, violations, incidents, capital projects, and reserve-fund tracking) so future
              reports can be generated with complete figures.
            </p>
            <p className="mreport-paragraph mreport-paragraph-footnote">
              This report is prepared for informational purposes only, based solely on records available in the PhilamLife system as of
              the date prepared. No figures have been estimated or fabricated; unavailable data is disclosed as such.
            </p>
          </section>
        </main>
      )}
    </div>
  )
}