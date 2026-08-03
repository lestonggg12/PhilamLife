import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import {
  AlertCircle,
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  Home,
  MapPin,
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

const eventDate = new Intl.DateTimeFormat('en-PH', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const eventMonth = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  timeZone: 'Asia/Manila',
})

const eventDay = new Intl.DateTimeFormat('en-PH', {
  day: '2-digit',
  timeZone: 'Asia/Manila',
})

const eventTime = new Intl.DateTimeFormat('en-PH', {
  hour: 'numeric',
  minute: '2-digit',
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

function manilaDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)

  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function parseManilaEventDate(value, time = '00:00:00') {
  if (!value) return null
  const parsed = new Date(`${value}T${time || '00:00:00'}+08:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatEventDate(value) {
  const parsed = parseManilaEventDate(value)
  return parsed ? eventDate.format(parsed) : 'Date to be announced'
}

function formatEventTime(start, end) {
  if (!start) return 'Time to be announced'
  const startDate = parseManilaEventDate('2000-01-01', start)
  const endDate = end ? parseManilaEventDate('2000-01-01', end) : null
  if (!startDate) return 'Time to be announced'
  return endDate
    ? `${eventTime.format(startDate)} – ${eventTime.format(endDate)}`
    : eventTime.format(startDate)
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 ** 2).toFixed(1)} MB`
}

export default function SecretaryDashboard() {
  const navigate = useNavigate()
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [activities, setActivities] = useState([])
  const [upcomingEvent, setUpcomingEvent] = useState(null)
  const [recentDocument, setRecentDocument] = useState(null)
  const [duesAmount, setDuesAmount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    setPageError('')

    const today = manilaDateKey()

    const [
      propertyResult,
      paymentResult,
      activityResult,
      settingsResult,
      eventResult,
      documentResult,
    ] =
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
        supabase
          .from('events')
          .select(
            'id, title, description, event_date, start_time, end_time, location',
          )
          .gte('event_date', today)
          .order('event_date', { ascending: true })
          .order('start_time', { ascending: true, nullsFirst: true })
          .limit(10),
        supabase
          .from('documents')
          .select(
            'id, title, category, original_file_name, file_size, uploaded_by_name, created_at',
          )
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

    const errors = [
      propertyResult.error,
      paymentResult.error,
      activityResult.error,
      settingsResult.error,
      eventResult.error,
      documentResult.error,
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
    const now = new Date()
    const nextEvent = (eventResult.data || []).find((item) => {
      if (item.event_date > today || !item.end_time) return true
      const eventEnds = parseManilaEventDate(item.event_date, item.end_time)
      return eventEnds ? eventEnds >= now : true
    })
    setUpcomingEvent(nextEvent || null)
    setRecentDocument(documentResult.data || null)
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setLoading(false)
  }

  const summary = useMemo(() => {
    const activePayments = payments.filter((payment) => payment.status !== 'Voided')

    const monthlyPayments = activePayments.filter((payment) =>
      sameManilaMonth(payment.paid_at),
    )
    const yearlyPayments = activePayments.filter((payment) =>
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
      const latestPayment = activePayments.find((payment) => {
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
        <article className="sec-panel sec-overview-panel">
          <div className="sec-panel-heading">
            <div>
              <h2>Secretary Overview</h2>
              <p>Your next schedule and newest HOA file</p>
            </div>
          </div>

          <div className="sec-overview-grid">
            <section className="sec-upcoming-card" aria-label="Upcoming scheduled event">
              <div className="sec-overview-label">
                <Calendar size={16} />
                Upcoming scheduled event
              </div>

              {loading ? (
                <p className="sec-overview-empty">Loading upcoming event...</p>
              ) : upcomingEvent ? (
                <div className="sec-event-content">
                  <div className="sec-event-date-tile" aria-hidden="true">
                    <span>
                      {eventMonth.format(
                        parseManilaEventDate(upcomingEvent.event_date),
                      )}
                    </span>
                    <strong>
                      {eventDay.format(
                        parseManilaEventDate(upcomingEvent.event_date),
                      )}
                    </strong>
                  </div>

                  <div className="sec-event-details">
                    <span className="sec-event-status">Next event</span>
                    <h3>{upcomingEvent.title}</h3>
                    <p className="sec-event-description">
                      {upcomingEvent.description || 'No event description provided.'}
                    </p>
                    <div className="sec-event-meta">
                      <span>
                        <Calendar size={14} />
                        {formatEventDate(upcomingEvent.event_date)}
                      </span>
                      <span>
                        <Clock size={14} />
                        {formatEventTime(
                          upcomingEvent.start_time,
                          upcomingEvent.end_time,
                        )}
                      </span>
                      <span>
                        <MapPin size={14} />
                        {upcomingEvent.location || 'Location to be announced'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="sec-overview-empty sec-overview-empty-event">
                  <Calendar size={29} />
                  <strong>No upcoming event scheduled</strong>
                  <span>Add an event to keep the Secretary informed.</span>
                </div>
              )}

              <button
                type="button"
                className="sec-overview-link"
                onClick={() => navigate('/calendar')}
              >
                Open Event Calendar
              </button>
            </section>

            <section className="sec-document-card" aria-label="Recently added document">
              <div className="sec-overview-label">
                <FileText size={16} />
                Recently added document
              </div>

              {loading ? (
                <p className="sec-overview-empty">Loading document...</p>
              ) : recentDocument ? (
                <div className="sec-document-content">
                  <span className="sec-document-icon">
                    <FileText size={24} />
                  </span>
                  <div>
                    <span className="sec-document-category">
                      {recentDocument.category || 'HOA document'}
                    </span>
                    <h3>{recentDocument.title}</h3>
                    <p>{recentDocument.original_file_name || 'Document file'}</p>
                    <dl className="sec-document-meta">
                      <div>
                        <dt>Added</dt>
                        <dd>{formatActivityTime(recentDocument.created_at)}</dd>
                      </div>
                      <div>
                        <dt>Size</dt>
                        <dd>{formatFileSize(recentDocument.file_size)}</dd>
                      </div>
                      <div>
                        <dt>Uploaded by</dt>
                        <dd>{recentDocument.uploaded_by_name || 'Secretary'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              ) : (
                <div className="sec-overview-empty sec-overview-empty-document">
                  <FileText size={29} />
                  <strong>No document uploaded yet</strong>
                  <span>The newest library file will appear here.</span>
                </div>
              )}

              <button
                type="button"
                className="sec-overview-link sec-document-link"
                onClick={() => navigate('/documents')}
              >
                Open Document Library
              </button>
            </section>
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