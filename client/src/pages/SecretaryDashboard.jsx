import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import {
  AlertCircle,
  CheckCircle,
  CreditCard,
  FileText,
  Home,
  TrendingUp,
  Users,
} from '../components/Icons'
import './SecretaryDashboard.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 2,
})

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

const normalize = (value) => String(value ?? '').trim().toLowerCase()

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

function sameManilaMonth(value, comparison = new Date()) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false

  const left = manilaDateParts(date)
  const right = manilaDateParts(comparison)
  return left.year === right.year && left.month === right.month
}

function sameManilaYear(value, comparison = new Date()) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return manilaDateParts(date).year === manilaDateParts(comparison).year
}

function formatActivityTime(value) {
  if (!value) return 'Time unavailable'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Time unavailable' : dateTime.format(parsed)
}

export default function SecretaryDashboard() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [activities, setActivities] = useState([])
  const [duesAmount, setDuesAmount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    setPageError('')

    const [propertyResult, paymentResult, activityResult, settingsResult] =
      await Promise.all([
        supabase
          .from('properties')
          .select('id, homeowner_name, block, lot_number'),
        supabase
          .from('payments')
          .select('*')
          .order('paid_at', { ascending: false }),
        supabase
          .from('activity_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('system_settings')
          .select('dues_amount')
          .eq('id', 1)
          .maybeSingle(),
      ])

    const errors = [
      propertyResult.error,
      paymentResult.error,
      activityResult.error,
    ].filter(Boolean)

    if (errors.length > 0) {
      setPageError(
        `Some dashboard information could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setActivities(activityResult.data || [])
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setLoading(false)
  }

  const summary = useMemo(() => {
    const monthlyPayments = payments.filter((payment) =>
      sameManilaMonth(payment.paid_at),
    )
    const yearlyPayments = payments.filter((payment) =>
      sameManilaYear(payment.paid_at),
    )

    const monthlyCollections = monthlyPayments.reduce(
      (sum, payment) => sum + (Number(payment.amount_paid) || 0),
      0,
    )
    const yearlyCollections = yearlyPayments.reduce(
      (sum, payment) => sum + (Number(payment.amount_paid) || 0),
      0,
    )

    const outstandingAccounts = properties.filter((property) => {
      const latestPayment = payments.find((payment) => {
        if (payment.property_id != null) {
          return Number(payment.property_id) === Number(property.id)
        }

        return (
          normalize(payment.homeowner_name) ===
            normalize(property.homeowner_name) &&
          normalize(payment.block_name) === normalize(property.block) &&
          normalize(payment.lot_number).replace(/^lot\s*/, '') ===
            String(property.lot_number)
        )
      })

      if (!latestPayment) return duesAmount > 0
      return Number(latestPayment.remaining_balance) > 0
    }).length

    return {
      monthlyCollections,
      yearlyCollections,
      outstandingAccounts,
      receiptsThisMonth: monthlyPayments.length,
    }
  }, [duesAmount, payments, properties])

  const recentPayments = payments.slice(0, 5)

  return (
    <div className="sec-secretary-dashboard">
      <header className="sec-page-header">
        <div>
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
          {loading ? 'Refreshing...' : 'Refresh data'}
        </button>
      </header>

      {pageError && <p className="sec-page-error">{pageError}</p>}

      <section className="sec-stats-grid" aria-label="Secretary summaries">
        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Total Homeowners</span>
            <span className="sec-stat-icon sec-stat-icon-blue">
              <Users size={19} />
            </span>
          </div>
          <strong className="sec-stat-value">
            {loading ? '—' : properties.length.toLocaleString('en-PH')}
          </strong>
          <p className="sec-stat-footer">Registered lots in the ledger</p>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Collections This Month</span>
            <span className="sec-stat-icon sec-stat-icon-green">
              <TrendingUp size={19} />
            </span>
          </div>
          <strong className="sec-stat-value sec-stat-currency">
            {loading ? '—' : peso.format(summary.monthlyCollections)}
          </strong>
          <p className="sec-stat-footer">
            {summary.receiptsThisMonth} receipt
            {summary.receiptsThisMonth === 1 ? '' : 's'} issued
          </p>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Collections This Year</span>
            <span className="sec-stat-icon sec-stat-icon-gold">
              <CreditCard size={19} />
            </span>
          </div>
          <strong className="sec-stat-value sec-stat-currency">
            {loading ? '—' : peso.format(summary.yearlyCollections)}
          </strong>
          <p className="sec-stat-footer">Annual recorded payments</p>
        </article>

        <article className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Outstanding Accounts</span>
            <span className="sec-stat-icon sec-stat-icon-red">
              <AlertCircle size={19} />
            </span>
          </div>
          <strong className="sec-stat-value">
            {loading ? '—' : summary.outstandingAccounts.toLocaleString('en-PH')}
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
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="4" className="sec-empty">Loading payments...</td>
                  </tr>
                ) : recentPayments.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="sec-empty">No payments recorded yet.</td>
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
                        {payment.lot_number ? `, ${payment.lot_number}` : ''}
                      </td>
                      <td className="sec-amount">
                        {peso.format(Number(payment.amount_paid) || 0)}
                      </td>
                      <td>
                        {payment.paid_at
                          ? formatActivityTime(payment.paid_at)
                          : '—'}
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
                <strong>Official Receipts</strong>

                <small>
                  Search, view, and reprint all receipts
                </small>
              </span>
            </button>

          <button
            type="button"
            className="sec-action"
            onClick={() => navigate('/secretary/payables')}
          >
            <span className="sec-action-icon"><CheckCircle size={19} /></span>
            <span>
              <strong>Payables & Collections</strong>
              <small>Review block collection status</small>
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
            <h2>Recent Secretary Activities</h2>
            <p>Your latest actions recorded by the system</p>
          </div>
          <button type="button" onClick={() => navigate('/activity-log')}>
            View activity log
          </button>
        </div>

        <div className="sec-activity-list">
          {loading ? (
            <p className="sec-empty">Loading activities...</p>
          ) : activities.length === 0 ? (
            <p className="sec-empty">No Secretary activities recorded yet.</p>
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