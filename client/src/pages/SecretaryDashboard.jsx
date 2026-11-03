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

  useEffect(() => {
    void loadDashboard()
    return () => { requestRef.current += 1 }
  }, [])

  async function loadDashboard() {
    const request = ++requestRef.current
    setLoading(true)
    setPageError('')

    try {
      const { year } = manilaDateParts()
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
            .limit(5),
          supabase
            .from('activity_log')
            .select('id, action, target, created_at')
            .order('created_at', { ascending: false })
            .limit(5),
          // Bound both ends: future-dated receipts must not inflate this year.
          supabase
            .from('monthly_collections')
            .select('month_start, dues_collected, dues_only_collected, dues_only_receipts')
            .gte('month_start', `${year}-01-01`)
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
      // Commit only a complete snapshot; an unsuccessful refresh must not replace
      // previously verified figures with zeros or partial records.
      setProperties(propertyResult.data)
      setRecentPayments(paymentResult.data)
      setMonthlyRows(monthlyResult.data)
      setActivities(activityResult.data)
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
    () => secretaryDashboardSummary(activeProperties, monthlyRows, manilaDateParts()),
    [activeProperties, monthlyRows],
  )

  return (
    <div className="sec-secretary-dashboard">
      <header className="sec-page-header">
        <div className="sec-header-content">
          <p className="sec-eyebrow">Secretary workspace</p>
          <h1 className="sec-page-title">Secretary Dashboard</h1>
          <p className="sec-page-subtitle">
            Manage homeowner records, collections, services, and receipts.
          </p>
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
            <span className="sec-stat-label">Total Homeowners</span>
            <span className="sec-stat-icon sec-stat-icon-blue">
              <Users size={19} />
            </span>
          </div>
          <strong className="sec-stat-value">
            {loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : !hasLoaded ? 'Unavailable' : activeProperties.length.toLocaleString('en-PH')}
          </strong>
          <p className="sec-stat-footer">Active homeowners in the ledger</p>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Association Dues Collected This Month</span>
            <span className="sec-stat-icon sec-stat-icon-green">
              <TrendingUp size={19} />
            </span>
          </div>
          <strong className="sec-stat-value sec-stat-currency">
            {loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : !hasLoaded ? 'Unavailable' : peso.format(summary.monthlyCollections)}
          </strong>
          <p className="sec-stat-footer">
            {summary.receiptsThisMonth} receipt
            {summary.receiptsThisMonth === 1 ? '' : 's'} for association dues
          </p>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Homeowner Collections This Year</span>
            <span className="sec-stat-icon sec-stat-icon-gold">
              <CreditCard size={19} />
            </span>
          </div>
          <strong className="sec-stat-value sec-stat-currency">
            {loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : !hasLoaded ? 'Unavailable' : peso.format(summary.yearlyCollections)}
          </strong>
          <p className="sec-stat-footer">All homeowner cash receipts this calendar year, including dues, balance payments and fees</p>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Outstanding Accounts</span>
            <span className="sec-stat-icon sec-stat-icon-red">
              <AlertCircle size={19} />
            </span>
          </div>
          <strong className="sec-stat-value">
            {loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : !hasLoaded ? 'Unavailable' : summary.outstandingAccounts.toLocaleString('en-PH')}
          </strong>
          <p className="sec-stat-footer">Accounts with a remaining balance</p>
        </article>
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