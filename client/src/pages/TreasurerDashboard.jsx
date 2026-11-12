import useManilaMonthRollover from '../hooks/useManilaMonthRollover'
import { isVerifiedDashboardSnapshot } from '../lib/dashboardSnapshot'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './TreasurerDashboard.css'
import {
  AlertCircle,
  Bank,
  CheckCircle,
  ChevronDown,
  CreditCard,
  DollarSign,
  FileText,
  RefreshCw,
  TrendingUp,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { loadTreasurerDashboard, summarizeTreasurerMonth } from '../lib/treasurerFinance'
import { useOrganization } from '../context/OrganizationContext'
import Skeleton from '../components/skeleton/Skeleton'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})


function manilaMonthKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}`
}

const amount = (row, keys) => {
  for (const key of keys) {
    const value = Number(row?.[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

const isVoided = (row) => String(row?.status || '').toLowerCase() === 'voided'


export default function TreasurerDashboard() {
  const { organization } = useOrganization()
  const [finance, setFinance] = useState({
    payments: [],
    monthly: null,
    expenses: [],
    services: [],
    properties: [],
    overdue: [],
    credits: null,
    adjustments: [],
    allocationEvidenceGaps: null,
    periods: [],
  })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)
  const [chartView, setChartView] = useState('flow')
  const [activityFilter, setActivityFilter] = useState('all')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const request = useRef(0)
  const [dashboardPeriod, setDashboardPeriod] = useState(() => manilaMonthKey())
  const [verifiedPeriod, setVerifiedPeriod] = useState(null)
  useManilaMonthRollover((nextMonth) => {
    setDashboardPeriod(nextMonth)
    void loadDashboard(nextMonth)
  })
  useEffect(() => {
    void loadDashboard(manilaMonthKey())
    return () => { request.current += 1 }
  }, [])

  useEffect(() => {
    if (!menuOpen) return undefined
    const onPointer = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  async function loadDashboard(period = manilaMonthKey()) {
    const sequence = ++request.current
    setLoading(true)
    setPageError('')
    try {
      const result = await loadTreasurerDashboard(supabase, `${period}-01`)
      if (sequence === request.current) {
        setFinance(result)
        setVerifiedPeriod(period)
        setUpdatedAt(new Date())
      }
    } catch (error) {
      if (sequence === request.current) setPageError(`Finance data is unavailable: ${error.message}`)
    } finally {
      if (sequence === request.current) setLoading(false)
    }
  }

  const dashboardUnavailable = !isVerifiedDashboardSnapshot({
    period: dashboardPeriod, verifiedPeriod, loading, error: pageError,
  })
  const summary = useMemo(() => {
    const month = summarizeTreasurerMonth(
      finance.monthly,
      finance.expenses,
      `${dashboardPeriod}-01`
    )

    const { outstanding = 0, aging = { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days90Plus: 0 }, overdue = 0, overdueAccounts = 0 } = finance.agingSummary || {}

    return {
      ...month,
      outstanding,
      overdue,
      creditsHeld: Number(finance.credits?.active_credit_total) || 0,
      creditAccounts: Number(finance.credits?.active_credit_accounts) || 0,
      movedCredit: Number(finance.credits?.moved_credit_total) || 0,
      aging,
      overdueAccounts,
    }
  }, [finance, dashboardPeriod])

  const exceptions = useMemo(() => {
    // account_adjustments has no status column — the closest available signal
    // for "needs review" is a non-reversed adjustment with no approval reference on file.
    const unreferencedAdjustments = finance.adjustments.filter((row) => {
      const isReversed = Boolean(row.reversed_at)
      const hasApproval = Boolean(String(row.approval_reference || '').trim())
      return !isReversed && !hasApproval
    }).length

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    const currentPeriod = finance.periods.find((row) => {
      const status = String(row.status || '').toLowerCase()

      return !['closed', 'locked'].includes(status)
        && (!row.starts_on || row.starts_on <= today)
        && (!row.ends_on || row.ends_on >= today)
    })

    return { unreferencedAdjustments, currentPeriod }
  }, [finance.adjustments, finance.periods, dashboardPeriod])

  const recentActivity = useMemo(() => {
    const rows = []
    finance.payments.forEach((row) => {
      if (isVoided(row)) return
      rows.push({
        id: `payment-${row.id}`,
        date: row.paid_at || row.created_at,
        title: 'Homeowner payment',
        detail: `${row.homeowner_name || 'Homeowner'} · ${row.receipt_number || 'Payment receipt'}`,
        amount: amount(row, ['amount_paid', 'amount']),
        direction: 'in',
      })
    })
    finance.services.forEach((row) => rows.push({
      id: `service-${row.id}`,
      date: row.paid_at || row.created_at,
      title: row.service_name || 'Amenity payment',
      detail: row.customer_name || 'Amenity revenue',
      amount: amount(row, ['amount_paid', 'amount']),
      direction: 'in',
    }))
    finance.expenses.forEach((row) => {
      if (isVoided(row)) return
      rows.push({
        id: `expense-${row.id}`,
        date: row.expense_date ? `${row.expense_date}T12:00:00+08:00` : row.created_at,
        title: row.category || 'Expense',
        detail: row.description || row.payee || 'Operating expense',
        amount: amount(row, ['amount']),
        direction: 'out',
      })
    })
    return rows
      .filter((row) => row.date)
      .sort((left, right) => new Date(right.date) - new Date(left.date))
      .slice(0, 8)
  }, [finance.expenses, finance.payments, finance.services])

  const show = (value) => (loading
    ? <Skeleton variant="rect" width="86px" height="1.2em" />
    : dashboardUnavailable ? 'Unavailable' : peso.format(value))
  const note = (text, loadingText = 'Loading finance data…') => (loading
    ? loadingText : dashboardUnavailable ? 'Financial data could not be verified' : text)

  const totalCollections = summary.collectedThisMonth + summary.servicesThisMonth
  const duesShare = totalCollections > 0 ? summary.collectedThisMonth / totalCollections : 0
  const percent = (part, whole) => (whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0)
  const flowScale = Math.max(totalCollections, summary.expensesThisMonth)
  const overduePercent = Math.round(percent(summary.overdue, summary.outstanding))
  const expenseRatio = percent(summary.expensesThisMonth, totalCollections)
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${dashboardPeriod}-01T00:00:00Z`))

  const DONUT_RADIUS = 58
  const circumference = 2 * Math.PI * DONUT_RADIUS
  const duesArc = duesShare * circumference
  const servicesArc = (1 - duesShare) * circumference
  const gap = duesShare > 0 && duesShare < 1 ? 2 : 0

  const agingRows = [
    ['Current', summary.aging.current, 'current'],
    ['1–30 days', summary.aging.days1To30, 'watch'],
    ['31–60 days', summary.aging.days31To60, 'warning'],
    ['61–90 days', summary.aging.days61To90, 'danger'],
    ['90+ days', summary.aging.days90Plus, 'critical'],
  ]

  const visibleActivity = recentActivity.filter((row) => activityFilter === 'all' || row.direction === activityFilter)

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
  const countBadge = (count) => (loading ? '…' : dashboardUnavailable ? '!' : count)
  const checkTone = (count, level) => (loading || dashboardUnavailable ? 'lo' : count > 0 ? level : 'ok')
  const allocationGaps = finance.allocationEvidenceGaps
  const checks = [
    {
      key: 'overdue', to: '/overdue-accounts', tone: checkTone(summary.overdueAccounts, 'hi'), badge: countBadge(summary.overdueAccounts),
      title: loading ? 'Checking…' : dashboardUnavailable ? 'Unavailable' : plural(summary.overdueAccounts, 'overdue account'),
      detail: loading ? 'Checking collections…' : dashboardUnavailable ? 'Collection totals could not be verified' : `${peso.format(summary.overdue)} needs collection follow-up`,
    },
    {
  key: 'allocation',
  tone: checkTone(allocationGaps ?? 0, 'md'),
  badge: loading
    ? '…'
    : dashboardUnavailable || allocationGaps == null
      ? '!'
      : allocationGaps,
  title: loading
    ? 'Checking…'
    : dashboardUnavailable || allocationGaps == null
      ? 'Allocation check unavailable'
      : `${plural(allocationGaps, 'payment')} without explicit charge links`,
  detail:
    'Historical payment records may lack bill-level allocation links. ' +
    'This does not mean cash or payments are missing. ' +
    'Review receipts and supporting records before assigning charges.',
},
    {
      key: 'adjustments', tone: checkTone(exceptions.unreferencedAdjustments, 'md'), badge: countBadge(exceptions.unreferencedAdjustments),
      title: loading ? 'Checking…' : dashboardUnavailable ? 'Unavailable' : `${plural(exceptions.unreferencedAdjustments, 'adjustment')} without approval references`,
      detail: 'Review documentation for any unreferenced adjustments',
    },

  ]
  const periodNote = loading ? 'Checking…' : dashboardUnavailable ? 'Unavailable' : exceptions.currentPeriod ? 'Accounting period open' : finance.periods.length === 0 ? 'Accounting periods not configured' : 'No open accounting period'

  return (
    <main className="treasurer-dashboard">
      <header className="treasurer-hero">
        <div className="td-hero-main">
          <span className="treasurer-eyebrow">Finance control center</span>
          <h1>Treasurer Dashboard</h1>
          <div className="td-hero-meta">
            <span className="td-month">{monthLabel}</span>
            <span className="td-sep" aria-hidden="true" />
            <span className="td-updated" role="status">{loading ? 'Refreshing…' : updatedAt ? `Updated ${organization.formatDate(updatedAt, { withTime: true })}` : ''}</span>
            <button type="button" className="td-refresh" onClick={() => loadDashboard(dashboardPeriod)} disabled={loading} aria-label="Refresh data" title="Refresh data">
              <RefreshCw size={15} className={loading ? 'treas-spin-icon' : ''} />
            </button>
          </div>
        </div>
        <div className="td-hero-actions">
          <Link className="td-btn primary" to="/payments"><CreditCard size={17} />Record payment</Link>
          <Link className="td-btn" to="/treasurer/expenses">Record expense</Link>
          <div className="td-menu-wrap" ref={menuRef}>
            <button type="button" className="td-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              More <ChevronDown size={14} />
            </button>
            {menuOpen && (
              <div className="td-menu" role="menu">
                <Link role="menuitem" to="/ledger" onClick={() => setMenuOpen(false)}><strong>Open ledger</strong><small>Balances and statements</small></Link>
                <Link role="menuitem" to="/treasurer/reports" onClick={() => setMenuOpen(false)}><strong>Financial reports</strong><small>Collections and cash review</small></Link>
                <Link role="menuitem" to="/overdue-accounts" onClick={() => setMenuOpen(false)}><strong>Overdue accounts</strong><small>Follow up on past-due balances</small></Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {pageError && <div className="treasurer-error" role="alert"><AlertCircle size={17} />{pageError}</div>}

      <section className="td-kpis" aria-label="This month at a glance">
        <article className="treasurer-stat-card">
          <div className="treasurer-stat-heading"><span>Total collections</span><span className="td-icon"><TrendingUp size={16} /></span></div>
          <strong>{show(totalCollections)}</strong>
          <small>{note('Dues and services this month')}</small>
          <div className="td-meter" aria-hidden="true"><i className="dues" style={{ width: `${duesShare * 100}%` }} /><i className="services" style={{ width: `${totalCollections > 0 ? (1 - duesShare) * 100 : 0}%` }} /></div>
        </article>
        <article className="treasurer-stat-card">
          <div className="treasurer-stat-heading"><span>Recorded expenses</span><span className="td-icon"><DollarSign size={16} /></span></div>
          <strong>{show(summary.expensesThisMonth)}</strong>
          <small>{note('Active expenses dated this month')}</small>
          <div className="td-meter" aria-hidden="true"><i className="expense" style={{ width: `${expenseRatio}%` }} /></div>
        </article>
        <article className={`treasurer-stat-card ${summary.netThisMonth < 0 ? 'is-negative' : 'is-positive'}`}>
          <div className="treasurer-stat-heading"><span>Net recorded activity</span><span className="td-icon"><TrendingUp size={16} /></span></div>
          <strong>{show(summary.netThisMonth)}</strong>
          <small>{note(totalCollections > 0 ? `Expenses are ${expenseRatio.toFixed(1)}% of collections` : 'Collections + services − dated expenses')}</small>
        </article>
        <article className="treasurer-stat-card">
          <div className="treasurer-stat-heading"><span>Outstanding receivables</span><span className="td-icon"><FileText size={16} /></span></div>
          <strong>{show(summary.outstanding)}</strong>
          <small>{note(`${peso.format(summary.overdue)} past due · ${plural(summary.overdueAccounts, 'account')}`)}</small>
          {!loading && !dashboardUnavailable && summary.outstanding > 0 && <span className="td-tag">{overduePercent}% overdue</span>}
        </article>
      </section>

      <section className="td-strip" aria-label="More figures">
        <article className="td-chip">
          <span className="td-chip-icon danger"><AlertCircle size={18} /></span>
          <div><span>Overdue balance</span><strong>{show(summary.overdue)}</strong></div>
          <small>Past due only</small>
        </article>
        <article className="td-chip">
          <span className="td-chip-icon"><DollarSign size={18} /></span>
          <div><span>Advance credits held</span><strong>{show(summary.creditsHeld)}</strong></div>
          <small>{note(`${summary.creditAccounts} active${summary.movedCredit > 0 ? ` · ${peso.format(summary.movedCredit)} moved` : ''}`, 'Loading…')}</small>
        </article>
        <article className="td-chip">
          <span className="td-chip-icon teal"><Bank size={18} /></span>
          <div><span>Service collections</span><strong>{show(summary.servicesThisMonth)}</strong></div>
          <small>Included in total collections</small>
        </article>
      </section>

      <section className="td-row" aria-label="Analytics">
        <article className="treasurer-panel">
          <div className="treasurer-panel-heading">
            <div>
              <h2>{chartView === 'flow' ? 'Collections & expenses' : 'Receivables aging'}</h2>
              <p className="td-sub">{chartView === 'flow' ? 'Current-month recorded activity' : 'How long balances have been outstanding'}</p>
            </div>
            <div className="td-seg" role="group" aria-label="Chart view">
              <button type="button" aria-pressed={chartView === 'flow'} onClick={() => setChartView('flow')}>Cash flow</button>
              <button type="button" aria-pressed={chartView === 'aging'} onClick={() => setChartView('aging')}>Receivables aging</button>
            </div>
          </div>
          {chartView === 'flow' ? (
            <div className="td-panel-body">
              <div className="td-bars">
                <div>
                  <div className="td-bar-top"><b>Collections</b><span>{show(totalCollections)}</span></div>
                  <div className="td-track"><i className="dues" style={{ width: `${percent(summary.collectedThisMonth, flowScale)}%` }} /><i className="services" style={{ width: `${percent(summary.servicesThisMonth, flowScale)}%` }} /></div>
                  <div className="td-legend-inline"><span className="td-dot dues">Dues &amp; payments {show(summary.collectedThisMonth)}</span><span className="td-dot services">Service receipts {show(summary.servicesThisMonth)}</span></div>
                </div>
                <div>
                  <div className="td-bar-top"><b>Expenses</b><span>{show(summary.expensesThisMonth)}</span></div>
                  <div className="td-track"><i className="expense" style={{ width: `${percent(summary.expensesThisMonth, flowScale)}%` }} /></div>
                  <div className="td-legend-inline"><span>Active expenses dated this month</span></div>
                </div>
              </div>
              <div className="td-net"><span>Net recorded activity<small>Collections less dated expenses</small></span><strong>{show(summary.netThisMonth)}</strong></div>
            </div>
          ) : (
            <div className="td-panel-body">
              <div className="td-aging-bar" aria-hidden="true">
                {agingRows.map(([label, value, tone]) => <i key={label} className={tone} style={{ width: `${percent(value, summary.outstanding)}%` }} />)}
              </div>
              <div className="td-aging-list">
                {agingRows.map(([label, value, tone]) => (
                  <div className="td-aging-row" key={label}>
                    <i className={tone} /><span>{label}</span><b>{show(value)}</b>
                    <em>{loading || dashboardUnavailable ? '' : `${percent(value, summary.outstanding).toFixed(1)}%`}</em>
                  </div>
                ))}
              </div>
              <div className="td-aging-foot">
                <span>Total receivables <b>{show(summary.outstanding)}</b></span>
                <Link className="treasurer-panel-link" to="/overdue-accounts">View overdue accounts →</Link>
              </div>
            </div>
          )}
        </article>

        <article className="treasurer-panel">
          <div className="treasurer-panel-heading"><div><h2>Where collections come from</h2><p className="td-sub">Current month · active receipts</p></div></div>
          <div className="td-panel-body td-donut-body">
            <div className="td-donut">
              <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={loading ? 'Loading collection mix' : dashboardUnavailable ? 'Collection mix unavailable' : totalCollections > 0 ? `Dues and payments ${Math.round(duesShare * 100)} percent, service receipts ${100 - Math.round(duesShare * 100)} percent` : 'No collections recorded'}>
                <circle className="track" cx="75" cy="75" r={DONUT_RADIUS} />
                {!loading && !dashboardUnavailable && totalCollections > 0 && <>
                  <circle className="dues" cx="75" cy="75" r={DONUT_RADIUS} strokeDasharray={`${Math.max(duesArc - gap, 0)} ${circumference}`} />
                  <circle className="services" cx="75" cy="75" r={DONUT_RADIUS} strokeDasharray={`${Math.max(servicesArc - gap, 0)} ${circumference}`} strokeDashoffset={-duesArc} />
                </>}
              </svg>
              <div className="td-donut-mid"><small>{loading ? 'Loading…' : dashboardUnavailable ? 'Unavailable' : totalCollections > 0 ? <>Collection<br />mix</> : <>No<br />collections</>}</small></div>
            </div>
            <div className="td-donut-total" aria-live="polite"><small>Total collected</small><strong>{loading ? '…' : dashboardUnavailable ? '—' : peso.format(totalCollections)}</strong></div>
            <div className="td-legend">
              <div><span className="td-dot dues">Dues &amp; payments</span><b>{loading || dashboardUnavailable ? '—' : `${Math.round(duesShare * 100)}%`}</b></div>
              <div><span className="td-dot services">Service receipts</span><b>{loading || dashboardUnavailable ? '—' : `${totalCollections > 0 ? 100 - Math.round(duesShare * 100) : 0}%`}</b></div>
            </div>
          </div>
        </article>
      </section>

      <section className="td-row" aria-label="Activity and checks">
        <article className="treasurer-panel activity-panel">
          <div className="treasurer-panel-heading">
            <div><h2>Recent financial activity</h2><p className="td-sub">Latest entries, newest first</p></div>
            <div className="td-heading-tools">
              <div className="td-seg" role="group" aria-label="Filter activity">
                {[['all', 'All'], ['in', 'Income'], ['out', 'Expenses']].map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={activityFilter === key} onClick={() => setActivityFilter(key)}>{label}</button>
                ))}
              </div>
              <Link className="treasurer-panel-link" to="/ledger">Open ledger →</Link>
            </div>
          </div>
          {loading ? <div aria-busy="true"><Skeleton variant="rect" width="100%" height="48px" /><Skeleton variant="rect" width="100%" height="48px" /><Skeleton variant="rect" width="100%" height="48px" /><span className="skeleton-region-status" role="status">Loading</span></div> : dashboardUnavailable ? <p className="treasurer-empty">Activity is unavailable. Use Refresh data to retry.</p> : recentActivity.length === 0 ? <p className="treasurer-empty">No financial activity recorded yet.</p> : visibleActivity.length === 0 ? <p className="treasurer-empty">No {activityFilter === 'in' ? 'income' : 'expense'} entries in the latest activity.</p> : (
            <div className="treasurer-activity-list">
              {visibleActivity.map((row) => (
                <div className={`treasurer-activity-row ${row.direction}`} key={row.id}>
                  <span className={`activity-direction ${row.direction}`}>{row.direction === 'in' ? '↓' : '↑'}</span>
                  <div><strong>{row.title}</strong><small>{row.detail} · {organization.formatDate(row.date)}</small></div>
                  <b className={row.direction === 'out' ? 'expense' : ''}>{row.direction === 'out' ? '−' : '+'}{peso.format(row.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="treasurer-panel exception-panel">
          <div className="treasurer-panel-heading"><div><h2>Needs attention</h2><p className="td-sub">Finance checks, most urgent first</p></div></div>
          <div className="td-checks">
            {checks.map(({ key, to, tone, badge, title, detail }) => {
              const content = (
                <>
                  <span className="td-check-badge">{badge}</span>
                  <span className="td-check-text"><strong>{title}</strong><small>{detail}</small></span>
                  {to && <span className="td-check-go" aria-hidden="true">›</span>}
                </>
              )
              return to
                ? <Link key={key} className={`td-check ${tone}`} to={to}>{content}</Link>
                : <div key={key} className={`td-check ${tone}`}>{content}</div>
            })}
            <p className="td-period"><strong>{periodNote}.</strong> Expense posting honors closed periods. Cash reconciliation requires source statements.</p>
          </div>
        </article>
      </section>
    </main>
  )
}