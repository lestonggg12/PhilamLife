import { LayoutDashboard } from 'lucide-react'
import Chart from 'chart.js/auto'
import useManilaMonthRollover from '../hooks/useManilaMonthRollover'
import { isVerifiedDashboardSnapshot } from '../lib/dashboardSnapshot'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { secretaryDashboardSummary } from '../lib/secretaryDashboardSummary'
import { fetchAll } from '../lib/fetchAll'
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  FileText,
  Home,
  RefreshCw,
  TrendingUp,
  Users,
} from '../components/Icons'
import { useOrganization } from '../context/OrganizationContext'
import Skeleton from '../components/skeleton/Skeleton'
import { formatDate as formatDateValue } from '../config/organization'
import './SecretaryDashboard.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 2,
})

function manilaDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value))

  return {
    year: parts.find((part) => part.type === 'year')?.value,
    month: parts.find((part) => part.type === 'month')?.value,
  }
}

function formatActivityTime(value, dateFormat) {
  if (!value) return 'Time unavailable'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Time unavailable' : formatDateValue(parsed, { dateFormat, withTime: true })
}

const BALANCE_ITEMS = [
  { key: 'balanceDue', label: 'Balance due', color: '#c96b59' },
  { key: 'advanceCredit', label: 'Advance credit', color: '#258d70' },
  { key: 'clear', label: 'Zero balance', color: '#3d88bb' },
]

export function buildSecretaryAnalytics(properties, monthlyRows, period) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Invalid analytics month.')
  const [year, month] = period.split('-').map(Number)
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1))
    return {
      key: date.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat('en-PH', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date),
      amount: 0,
    }
  })
  for (const row of monthlyRows) {
    const entry = months.find(item => item.key === String(row.month_start).slice(0, 7))
    if (!entry) continue
    const raw = row.dues_collected
    const cents = Math.round(Number(raw) * 100)
    if (raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw)) || !Number.isSafeInteger(cents) || cents < 0) {
      throw new Error('Collections analytics contain an unavailable amount.')
    }
    entry.amount = cents / 100
  }
  const balances = { balanceDue: 0, advanceCredit: 0, clear: 0, total: 0 }
  for (const property of properties) {
    if ((property.homeowner_status || 'active') !== 'active') continue
    const raw = property.current_balance
    if (raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw))) throw new Error('Account balance analytics are unavailable.')
    const cents = Math.round(Number(raw) * 100)
    if (!Number.isSafeInteger(cents)) throw new Error('Account balance is outside the supported range.')
    balances[cents > 0 ? 'balanceDue' : cents < 0 ? 'advanceCredit' : 'clear'] += 1
    balances.total += 1
  }
  return { months, balances }
}

export default function SecretaryDashboard() {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const [properties, setProperties] = useState([])
  const [recentPayments, setRecentPayments] = useState([])
  const [monthlyRows, setMonthlyRows] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [hasLoaded, setHasLoaded] = useState(false)
  const requestRef = useRef(0)
  const collectionChartRef = useRef(null)
  const balanceChartRef = useRef(null)
  const [dashboardPeriod, setDashboardPeriod] = useState(() => {
    const { year, month } = manilaDateParts()
    return year + '-' + month
  })
  const [verifiedPeriod, setVerifiedPeriod] = useState(null)
  useManilaMonthRollover((nextMonth) => {
    setDashboardPeriod(nextMonth)
    setHasLoaded(false)
    void loadDashboard()
  })

  useEffect(() => {
    void loadDashboard()
    return () => { requestRef.current += 1 }
  }, [])

  async function loadDashboard() {
    const request = ++requestRef.current
    setLoading(true)
    setPageError('')

    try {
      const { year, month } = manilaDateParts()
      const requestedPeriod = year + '-' + month
      const firstChartMonth = buildSecretaryAnalytics([], [], requestedPeriod).months[0].key + '-01'
      const historyStart = [firstChartMonth, `${year}-01-01`].sort()[0]
      const [propertyResult, paymentResult, activityResult, monthlyResult] =
        await Promise.all([
          fetchAll(() => supabase
            .from('properties')
            .select('id, homeowner_name, block, lot_number, homeowner_status, current_balance')),
          // Include legacy null-status payments, but never cancelled ones.
          supabase
            .from('payments')
            .select('id, homeowner_name, coverage_period, block_name, lot_number, amount_paid, paid_at, status')
            .or('status.is.null,status.neq.Voided')
            .order('paid_at', { ascending: false })
            .limit(6),
          supabase
            .from('activity_log')
            .select('id, action, target, created_at')
            .order('created_at', { ascending: false })
            .limit(5),
          // Bound both ends: future-dated receipts must not inflate this year.
          supabase
            .from('monthly_collections')
            .select('month_start, dues_collected, dues_only_collected, dues_only_receipts')
            .gte('month_start', historyStart)
            .lt('month_start', `${Number(year) + 1}-01-01`)
            .order('month_start'),
        ])

      if (request !== requestRef.current) return
      const errors = [propertyResult.error, paymentResult.error, activityResult.error, monthlyResult.error].filter(Boolean)
      if (errors.length) throw new Error(errors.map((error) => error.message).join(' '))
      if (![propertyResult.data, paymentResult.data, activityResult.data, monthlyResult.data].every(Array.isArray)) {
        throw new Error('One or more dashboard queries returned incomplete data.')
      }
      secretaryDashboardSummary(propertyResult.data, monthlyResult.data, manilaDateParts())
      buildSecretaryAnalytics(propertyResult.data, monthlyResult.data, requestedPeriod)
      // Commit only a complete snapshot; an unsuccessful refresh must not replace
      // previously verified figures with zeros or partial records.
      setProperties(propertyResult.data)
      setRecentPayments(paymentResult.data)
      setMonthlyRows(monthlyResult.data)
      setActivities(activityResult.data)
      setVerifiedPeriod(requestedPeriod)
      setHasLoaded(true)
    } catch (error) {
      if (request === requestRef.current) {
        setPageError(`Dashboard could not be refreshed: ${error?.message || 'Connection unavailable'}. ${hasLoaded ? 'Showing the last successfully loaded figures.' : 'Retry to load dashboard figures.'}`)
      }
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  const activeProperties = useMemo(
    () => properties.filter((property) => (property.homeowner_status || 'active') === 'active'),
    [properties],
  )

  const summary = useMemo(
    () => secretaryDashboardSummary(activeProperties, monthlyRows, {
      year: dashboardPeriod.slice(0, 4), month: dashboardPeriod.slice(5),
    }),
    [activeProperties, monthlyRows, dashboardPeriod],
  )
  const dashboardUnavailable = !hasLoaded || !isVerifiedDashboardSnapshot({
    period: dashboardPeriod, verifiedPeriod, loading, error: pageError,
  })

  const analytics = useMemo(
    () => buildSecretaryAnalytics(properties, monthlyRows, dashboardPeriod),
    [properties, monthlyRows, dashboardPeriod],
  )

  useEffect(() => {
    if (dashboardUnavailable) return undefined
    const charts = []
    if (collectionChartRef.current) {
      charts.push(new Chart(collectionChartRef.current, {
        type: 'bar',
        data: {
          labels: analytics.months.map(item => item.label),
          datasets: [{ label: 'Homeowner collections', data: analytics.months.map(item => item.amount), backgroundColor: '#3d8ec5', borderColor: '#247bb4', borderWidth: 1, borderRadius: 7, maxBarThickness: 44 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `Homeowner collections: ${peso.format(context.parsed.y)}` } } },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: '#5d7f96', font: { size: 11 }, maxRotation: 0 } },
            y: { beginAtZero: true, border: { display: false }, grid: { color: '#e2edf5' }, ticks: { color: '#69889e', maxTicksLimit: 5, callback: value => peso.format(value) } },
          },
        },
      }))
    }
    if (balanceChartRef.current && analytics.balances.total > 0) {
      charts.push(new Chart(balanceChartRef.current, {
        type: 'doughnut',
        data: { labels: BALANCE_ITEMS.map(item => item.label), datasets: [{ data: BALANCE_ITEMS.map(item => analytics.balances[item.key]), backgroundColor: BALANCE_ITEMS.map(item => item.color), borderColor: '#fff', borderWidth: 3, hoverOffset: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, cutout: '76%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.label}: ${context.parsed.toLocaleString('en-PH')} properties` } } } },
      }))
    }
    return () => charts.forEach(chart => chart.destroy())
  }, [analytics, dashboardUnavailable])

  return (
    <div className="sec-secretary-dashboard">
      <header className="sec-page-header">
        <div className="sec-header-heading">
          <span className="sec-header-icon" aria-hidden="true"><LayoutDashboard size={28} strokeWidth={1.8} /></span>
          <div className="sec-header-content">
            <p className="sec-eyebrow">Secretary workspace</p>
            <h1 className="sec-page-title">Secretary Dashboard</h1>
            <p className="sec-page-subtitle">
              Manage homeowner records, collections, services, and receipts.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="sec-refresh-button"
          onClick={loadDashboard}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'sec-spin-icon' : ''} />
          {loading ? 'Refreshing...' : 'Refresh data'}
        </button>
      </header>

      {pageError && <p className="sec-page-error" role="alert">{pageError} <button type="button" onClick={loadDashboard} disabled={loading}>Retry</button></p>}

      <section className="sec-stats-grid" aria-label="Secretary summaries">
        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Active Property Accounts</span>
            <span className="sec-stat-icon sec-stat-icon-blue">
              <Users size={19} />
            </span>
          </div>
          <strong className="sec-stat-value">
            {loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : !hasLoaded ? 'Unavailable' : activeProperties.length.toLocaleString('en-PH')}
          </strong>
          <p className="sec-stat-description">All active property accounts, including homeowners and lot owners</p>
          <div className="sec-stat-footer"><span className="sec-stat-dot" aria-hidden="true" />Registered active properties</div>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Association Dues Collected This Month</span>
            <span className="sec-stat-icon sec-stat-icon-green">
              <TrendingUp size={19} />
            </span>
          </div>
          <strong className="sec-stat-value sec-stat-currency">
            {loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : dashboardUnavailable ? 'Unavailable' : peso.format(summary.monthlyCollections)}
          </strong>
          <p className="sec-stat-description">
            {summary.receiptsThisMonth} receipt
            {summary.receiptsThisMonth === 1 ? '' : 's'} for association dues
          </p>
          <div className="sec-stat-footer"><span className="sec-stat-dot" aria-hidden="true" />Association dues receipts only</div>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Homeowner Collections This Year</span>
            <span className="sec-stat-icon sec-stat-icon-gold">
              <CreditCard size={19} />
            </span>
          </div>
          <strong className="sec-stat-value sec-stat-currency">
            {loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : dashboardUnavailable ? 'Unavailable' : peso.format(summary.yearlyCollections)}
          </strong>
          <p className="sec-stat-description">All homeowner cash receipts this calendar year, including dues, balance payments and fees</p>
          <div className="sec-stat-footer"><span className="sec-stat-dot" aria-hidden="true" />Homeowner cash receipts</div>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Outstanding Accounts</span>
            <span className="sec-stat-icon sec-stat-icon-red">
              <AlertCircle size={19} />
            </span>
          </div>
          <strong className="sec-stat-value">
            {loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : dashboardUnavailable ? 'Unavailable' : summary.outstandingAccounts.toLocaleString('en-PH')}
          </strong>
          <p className="sec-stat-description">Accounts with a remaining balance</p>
          <div className="sec-stat-footer"><span className="sec-stat-dot" aria-hidden="true" />Accounts requiring follow-up</div>
        </article>
      </section>

      <section className="sec-analytics" aria-labelledby="sec-analytics-title" aria-busy={loading}>
        <div className="sec-analytics-heading"><h2 id="sec-analytics-title">Analytics Overview</h2><span>Last 6 months</span></div>
        <div className="sec-charts-grid">
          <article className="sec-panel sec-chart-panel">
            <header className="sec-chart-heading"><div><span className="sec-chart-kicker">Collections trend</span><h3>Homeowner collections</h3><p>{analytics.months[0].label} – {analytics.months[5].label}</p></div><span className="sec-chart-period">Cash receipts</span></header>
            {dashboardUnavailable ? <div className="sec-chart-state" role="status">{loading ? 'Loading collection analytics…' : 'Collection analytics are unavailable. Refresh to try again.'}</div> : <>
              <div className="sec-bar-plot"><canvas ref={collectionChartRef} role="img" aria-label="Homeowner collections for the last six months. Values are available in the following table." /></div>
              <table className="sec-chart-data"><caption>Monthly homeowner collections</caption><thead><tr><th>Month</th><th>Collections</th></tr></thead><tbody>{analytics.months.map(item => <tr key={item.key}><th scope="row">{item.label}</th><td>{peso.format(item.amount)}</td></tr>)}</tbody></table>
              <p className="sec-chart-note"><i aria-hidden="true" />All homeowner cash receipts, including dues, balance payments and fees. Service receipts excluded.</p>
            </>}
          </article>
          <article className="sec-panel sec-chart-panel">
            <header className="sec-chart-heading"><div><span className="sec-chart-kicker">Active property accounts</span><h3>Account balance status</h3><p>{dashboardUnavailable ? 'Waiting for verified records' : `${analytics.balances.total.toLocaleString('en-PH')} active properties`}</p></div><span className="sec-chart-period">Balance mix</span></header>
            {dashboardUnavailable ? <div className="sec-chart-state" role="status">{loading ? 'Loading account analytics…' : 'Account analytics are unavailable. Refresh to try again.'}</div> : analytics.balances.total === 0 ? <div className="sec-chart-state">No active property accounts yet.</div> : <div className="sec-balance-layout">
              <div className="sec-donut-plot"><canvas ref={balanceChartRef} role="img" aria-label="Active property balance distribution. Counts follow in the legend." /><div className="sec-donut-center"><strong>{analytics.balances.total.toLocaleString('en-PH')}</strong><span>PROPERTIES</span></div></div>
              <ul className="sec-balance-legend">{BALANCE_ITEMS.map(item => {
                const count = analytics.balances[item.key]
                const percent = count / analytics.balances.total * 100
                return <li key={item.key}><span className="sec-legend-dot" style={{ backgroundColor: item.color }} aria-hidden="true" /><div><div className="sec-legend-heading"><strong>{item.label}</strong><span>{count > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`}</span></div><small>{count.toLocaleString('en-PH')} properties</small><div className="sec-legend-track" aria-hidden="true"><span style={{ width: `${percent}%`, backgroundColor: item.color }} /></div></div></li>
              })}</ul>
            </div>}
          </article>
        </div>
      </section>

      <section className="sec-content-grid">
        <article className="sec-panel">
          <div className="sec-panel-heading">
            <div>
              <h2>Recent Payments</h2>
              <p>Latest transactions recorded by staff</p>
            </div>
            <button type="button" onClick={() => navigate('/payments')}>
              View all
            </button>
          </div>

          <div className="sec-table-wrap">
            <table className="sec-payments-table">
              <thead>
                <tr>
                  <th>Homeowner</th>
                  <th>Property</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5" className="sec-empty"><div aria-busy="true"><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><span className="skeleton-region-status" role="status">Loading</span></div></td>
                  </tr>
                ) : !hasLoaded || recentPayments.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="sec-empty">{hasLoaded ? 'No payments recorded yet.' : 'Payment history is unavailable.'}</td>
                  </tr>
                ) : (
                  recentPayments.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <strong>{payment.homeowner_name || 'Unnamed homeowner'}</strong>
                        <span>{payment.coverage_period || 'No coverage specified'}</span>
                      </td>
                      <td>
                        {payment.block_name || '—'}
                        {payment.lot_number
                          ? `, ${String(payment.lot_number).toLowerCase().startsWith('lot') ? payment.lot_number : `Lot ${payment.lot_number}`}`
                          : ''}
                      </td>
                      <td className="sec-amount">
                        {peso.format(Number(payment.amount_paid) || 0)}
                      </td>
                      <td>
                        {payment.paid_at
                          ? formatActivityTime(payment.paid_at, organization.dateFormat)
                          : '—'}
                      </td>
                      <td>
                        <span className={payment.status === 'Voided' ? 'sec-status-voided' : 'sec-status-completed'}>
                          {payment.status === 'Voided' ? 'Voided' : 'Completed'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="sec-panel sec-actions-panel">
          <div className="sec-panel-heading">
            <div>
              <h2>Quick Actions</h2>
              <p>Open common Secretary tools</p>
            </div>
          </div>

          <button type="button" className="sec-action" onClick={() => navigate('/secretary/grievances')}>
            <span className="sec-action-icon"><FileText size={19} /></span>
            <span><strong>Grievances</strong><small>Complaints, case history and period statements</small></span>
          </button>

          <button type="button" className="sec-action" onClick={() => navigate('/ledger')}>
            <span className="sec-action-icon"><Home size={19} /></span>
            <span>
              <strong>Open Ledger</strong>
              <small>Homeowners, blocks, and balances</small>
            </span>
          </button>

          <button type="button" className="sec-action" onClick={() => navigate('/payments')}>
            <span className="sec-action-icon"><CreditCard size={19} /></span>
            <span>
              <strong>Record Payment</strong>
              <small>Save a transaction and issue a receipt</small>
            </span>
          </button>

          <button
              type="button"
              className="sec-action"
              onClick={() =>
                navigate('/secretary/receipts')
              }
            >
              <span className="sec-action-icon">
                <FileText size={19} />
              </span>

              <span>
                <strong>Payment Receipts</strong>

                <small>
                  Search, view, and reprint all receipts
                </small>
              </span>
            </button>

                <button
  type="button"
  className="sec-action"
  onClick={() => navigate('/secretary/services')}
>
  <span className="sec-action-icon"><FileText size={19} /></span>
  <span>
    <strong>Services Management</strong>
    <small>Amenity payments and service receipts</small>
  </span>
</button>


          <button type="button" className="sec-action" onClick={() => navigate('/documents')}>
            <span className="sec-action-icon"><FileText size={19} /></span>
            <span>
              <strong>Document Library</strong>
              <small>Open HOA records and files</small>
            </span>
          </button>
        </aside>
      </section>

      <section className="sec-panel sec-activity-panel">
        <div className="sec-panel-heading">
          <div>
            <h2>Recent Activities</h2>
            <p>Latest actions recorded by the system</p>
          </div>
          <button type="button" onClick={() => navigate('/activity-log')}>
            View activity log
          </button>
        </div>

        <div className="sec-activity-list">
          {loading ? (
            <div className="sec-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><span className="skeleton-region-status" role="status">Loading</span></div>
          ) : !hasLoaded || activities.length === 0 ? (
            <p className="sec-empty">{hasLoaded ? 'No activities recorded yet.' : 'Activity history is unavailable.'}</p>
          ) : (
            activities.map((activity) => (
              <div className="sec-activity-row" key={activity.id}>
                <span className="sec-activity-mark">
                  <CheckCircle size={17} />
                </span>
                <div>
                  <strong>{activity.action || 'System activity'}</strong>
                  <p>{activity.target || activity.description || 'No details available'}</p>
                </div>
                <time>
                  {formatActivityTime(
                    activity.created_at || activity.timestamp || activity.occurred_at,
                    organization.dateFormat,
                  )}
                </time>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}