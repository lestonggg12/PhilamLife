import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Calendar,
  CreditCard,
  FileText,
  Home,
  Mail,
  Phone,
  RefreshCw,
  Search,
  Users,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import { formatDate as formatDateValue } from '../config/organization'
import './HomeownersPage.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const manilaYearMonth = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  timeZone: 'Asia/Manila',
})

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat('en-PH', { month: 'long' }).format(
    new Date(2024, month, 1),
  ),
)

const normalize = (value) => String(value ?? '').trim().toLowerCase()
const normalizeLot = (value) => normalize(value).replace(/^lot\s*/, '')

// Homeowners marked Moved or Transferred (in Contact Manager) are excluded
// from this page entirely — they should not appear in the directory, in
// search results, or be reachable by direct link. Their records and
// payment history remain intact in the database; they're just not shown
// here anymore.
function isActiveHomeowner(property) {
  const status = normalize(property.homeowner_status || 'active')
  return status !== 'moved' && status !== 'transferred'
}

function storedStatusLabel(value, fallback = 'Not recorded') {
  const normalized = normalize(value)
  if (!normalized) return fallback

  const labels = {
    completed: 'Completed',
    paid: 'Paid',
    partial: 'Partial',
    pending: 'Pending',
    recorded: 'Recorded',
    voided: 'Voided',
  }

  return (
    labels[normalized] ||
    normalized.replace(/(^|[\s_-])\w/g, (character) => character.toUpperCase())
  )
}

function initials(name) {
  return String(name || 'Homeowner')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
}

function formatDate(value, dateFormat) {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : formatDateValue(parsed, { dateFormat, withTime: true })
}

function getManilaYearMonth(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  const parts = Object.fromEntries(
    manilaYearMonth
      .formatToParts(parsed)
      .filter(({ type }) => type === 'year' || type === 'month')
      .map(({ type, value: partValue }) => [type, Number(partValue)]),
  )

  return parts.year && parts.month
    ? { year: parts.year, month: parts.month - 1 }
    : null
}

function trackerStatus(records) {
  if (!records.length) {
    return { key: 'empty', label: 'No payment recorded' }
  }

  const statuses = records.map((record) => normalize(record.statusKey))
  if (statuses.some((status) => status === 'partial' || status === 'pending')) {
    return { key: 'partial', label: 'Partial / Pending' }
  }

  if (statuses.every((status) => status === 'paid' || status === 'completed')) {
    return { key: 'paid', label: 'Paid' }
  }

  return { key: 'recorded', label: 'Recorded' }
}

function paymentMatchesProperty(payment, property) {
  if (payment.property_id != null) {
    return String(payment.property_id) === String(property.id)
  }

  return (
    normalize(payment.homeowner_name) === normalize(property.homeowner_name) &&
    normalize(payment.block_name) === normalize(property.block) &&
    normalizeLot(payment.lot_number) === normalizeLot(property.lot_number)
  )
}

function serviceMatchesProperty(transaction, property) {
  if (transaction.property_id != null) {
    return String(transaction.property_id) === String(property.id)
  }

  return (
    normalize(transaction.customer_name) === normalize(property.homeowner_name) &&
    normalize(transaction.block_name) === normalize(property.block) &&
    normalizeLot(transaction.lot_number) === normalizeLot(property.lot_number)
  )
}

function regularPaymentCategory(payment) {
  const coverage = normalize(payment.coverage_period)
  return coverage.includes('association dues') ? 'dues' : 'other'
}

function homeownerStatus(propertyPayments) {
  const active = propertyPayments.filter(
    (payment) => normalize(payment.status) !== 'voided',
  )
  if (!active.length) return { key: 'no-history', label: 'No payment history' }

  const latest = active[0]
  if ((Number(latest.remaining_balance) || 0) > 0) {
    return { key: 'balance', label: 'With balance' }
  }

  return { key: 'current', label: 'Current' }
}

export default function HomeownersPage() {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const { homeownerId } = useParams()
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [resultsOpen, setResultsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [trackerView, setTrackerView] = useState('monthly')
  const [trackerYear, setTrackerYear] = useState(() =>
    getManilaYearMonth(new Date())?.year || new Date().getFullYear(),
  )
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const searchWrapRef = useRef(null)
  const trackerRef = useRef(null)

  useEffect(() => {
    loadHomeowners()
  }, [])

  useEffect(() => {
    setActiveTab('overview')
    setTrackerOpen(false)
    setTrackerView('monthly')
    setTrackerYear(
      getManilaYearMonth(new Date())?.year || new Date().getFullYear(),
    )
  }, [homeownerId])

  // Close the results dropdown on outside click, not just on blur, so it
  // also closes when the click lands on the filter select or elsewhere.
  useEffect(() => {
    function handleOutsideClick(event) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target)) {
        setResultsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  async function loadHomeowners(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setPageError('')

    const [propertyResult, paymentResult, serviceResult] = await Promise.all([
      supabase
        .from('properties')
        .select(
          'id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, created_at, homeowner_status',
        )
        .order('homeowner_name'),
      supabase
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false }),
      supabase
        .from('service_transactions')
        .select('*')
        .order('paid_at', { ascending: false }),
    ])

    const errors = [
      propertyResult.error,
      paymentResult.error,
      serviceResult.error,
    ].filter(Boolean)

    // Moved/transferred homeowners are dropped here, before anything else
    // in the component ever sees them — they cannot appear in the
    // directory, search results, or be selected via a stale URL.
    setProperties((propertyResult.data || []).filter(isActiveHomeowner))
    setPayments(paymentResult.data || [])
    setServiceTransactions(serviceResult.data || [])

    if (errors.length) {
      setPageError(
        `Some homeowner information could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setLoading(false)
    setRefreshing(false)
  }

  const directoryEntries = useMemo(
    () =>
      properties.map((property) => {
        const propertyPayments = payments.filter((payment) =>
          paymentMatchesProperty(payment, property),
        )
        return {
          property,
          status: homeownerStatus(propertyPayments),
        }
      }),
    [payments, properties],
  )

  const hasQuery = search.trim().length > 0
  const hasFilter = statusFilter !== 'all'

  const filteredDirectory = useMemo(() => {
    if (!hasQuery && !hasFilter) return []
    const term = normalize(search)
    return directoryEntries.filter(({ property, status }) => {
      const matchesSearch =
        !term ||
        [
          property.homeowner_name,
          property.block,
          `Lot ${property.lot_number}`,
          property.contact_phone,
          property.contact_email,
        ].some((value) => normalize(value).includes(term))
      const matchesStatus = statusFilter === 'all' || status.key === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [directoryEntries, hasFilter, hasQuery, search, statusFilter])

  const showResults = resultsOpen && (hasQuery || hasFilter)

  function handleSelectHomeowner(id) {
    navigate(`/homeowners/${id}`)
    setSearch('')
    setResultsOpen(false)
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setResultsOpen(false)
      event.target.blur()
    }
  }

  const selectedProperty = useMemo(
    () =>
      properties.find(
        (property) => String(property.id) === String(homeownerId),
      ) || null,
    [homeownerId, properties],
  )

  const selectedPayments = useMemo(
    () =>
      selectedProperty
        ? payments.filter((payment) =>
            paymentMatchesProperty(payment, selectedProperty),
          )
        : [],
    [payments, selectedProperty],
  )

  const selectedServices = useMemo(
    () =>
      selectedProperty
        ? serviceTransactions.filter((transaction) =>
            serviceMatchesProperty(transaction, selectedProperty),
          )
        : [],
    [selectedProperty, serviceTransactions],
  )

  const activePayments = useMemo(
    () =>
      selectedPayments.filter(
        (payment) => normalize(payment.status) !== 'voided',
      ),
    [selectedPayments],
  )

  const duesPayments = useMemo(
    () =>
      selectedPayments.filter(
        (payment) => regularPaymentCategory(payment) === 'dues',
      ),
    [selectedPayments],
  )

  const otherPayments = useMemo(
    () =>
      selectedPayments.filter(
        (payment) => regularPaymentCategory(payment) === 'other',
      ),
    [selectedPayments],
  )

  const history = useMemo(() => {
    const regular = selectedPayments.map((payment) => {
      const remaining = Number(payment.remaining_balance) || 0
      return {
        id: `payment-${payment.id}`,
        kind: regularPaymentCategory(payment),
        category:
          regularPaymentCategory(payment) === 'dues'
            ? 'Association Dues'
            : 'Other',
        receipt: payment.receipt_number || '—',
        description: payment.coverage_period || payment.note || 'Payment',
        amount: Number(payment.amount_paid ?? payment.amount) || 0,
        remaining,
        method: payment.payment_method || '—',
        statusKey: normalize(payment.status),
        status: storedStatusLabel(payment.status),
        paidAt: payment.paid_at,
      }
    })

    const services = selectedServices.map((transaction) => {
      const remaining = Math.max(
        (Number(transaction.amount_due) || 0) -
          (Number(transaction.amount_paid) || 0),
        0,
      )
      return {
        id: `service-${transaction.id}`,
        kind: 'services',
        category: 'Amenities',
        receipt: transaction.receipt_number || '—',
        description: transaction.service_name || 'Amenity or service',
        amount: Number(transaction.amount_paid) || 0,
        remaining,
        method: transaction.payment_method || '—',
        statusKey: normalize(transaction.payment_status),
        status: storedStatusLabel(transaction.payment_status),
        paidAt: transaction.paid_at,
      }
    })

    return [...regular, ...services].sort(
      (left, right) =>
        new Date(right.paidAt || 0).getTime() -
        new Date(left.paidAt || 0).getTime(),
    )
  }, [selectedPayments, selectedServices])

  const summary = useMemo(() => {
    const regularTotal = activePayments.reduce(
      (sum, payment) =>
        sum + (Number(payment.amount_paid ?? payment.amount) || 0),
      0,
    )
    const serviceTotal = selectedServices.reduce(
      (sum, transaction) => sum + (Number(transaction.amount_paid) || 0),
      0,
    )
    const latestRegularPayment = activePayments[0]
    const outstanding = Number(latestRegularPayment?.remaining_balance) || 0
    const latestRecord = history[0]

    return {
      totalPaid: regularTotal + serviceTotal,
      outstanding,
      lastPayment: latestRecord ? formatDate(latestRecord.paidAt, organization.dateFormat) : 'No payments yet',
      receipts: history.length,
    }
  }, [activePayments, history, selectedServices])

  const visibleHistory = useMemo(() => {
    if (activeTab === 'dues') return history.filter((item) => item.kind === 'dues')
    if (activeTab === 'services') {
      return history.filter((item) => item.kind === 'services')
    }
    if (activeTab === 'other') return history.filter((item) => item.kind === 'other')
    return history
  }, [activeTab, history])

  const trackerRecords = useMemo(
    () =>
      history
        .map((record) => ({
          ...record,
          trackerDate: getManilaYearMonth(record.paidAt),
        }))
        .filter(
          (record) => record.trackerDate && record.statusKey !== 'voided',
        ),
    [history],
  )

  const trackerYears = useMemo(() => {
    const currentYear = getManilaYearMonth(new Date())?.year || new Date().getFullYear()
    return Array.from(
      new Set([
        currentYear,
        ...trackerRecords.map((record) => record.trackerDate.year),
      ]),
    ).sort((left, right) => right - left)
  }, [trackerRecords])

  const monthlyTracker = useMemo(
    () =>
      monthNames.map((month, monthIndex) => {
        const records = trackerRecords.filter(
          (record) =>
            record.trackerDate.year === trackerYear &&
            record.trackerDate.month === monthIndex,
        )
        const categoryTotal = (kind) =>
          records
            .filter((record) => record.kind === kind)
            .reduce((sum, record) => sum + record.amount, 0)

        const dues = categoryTotal('dues')
        const services = categoryTotal('services')
        const other = categoryTotal('other')

        return {
          month,
          records,
          status: trackerStatus(records),
          dues,
          services,
          other,
          total: dues + services + other,
        }
      }),
    [trackerRecords, trackerYear],
  )

  const annualTracker = useMemo(
    () =>
      trackerYears.map((year) => {
        const records = trackerRecords.filter(
          (record) => record.trackerDate.year === year,
        )
        const categoryTotal = (kind) =>
          records
            .filter((record) => record.kind === kind)
            .reduce((sum, record) => sum + record.amount, 0)
        const dues = categoryTotal('dues')
        const services = categoryTotal('services')
        const other = categoryTotal('other')

        return {
          year,
          months: new Set(records.map((record) => record.trackerDate.month)).size,
          transactions: records.length,
          dues,
          services,
          other,
          total: dues + services + other,
        }
      }),
    [trackerRecords, trackerYears],
  )

  function togglePaymentTracker() {
    setTrackerOpen((isOpen) => !isOpen)
  }

  function closePaymentTracker() {
    setTrackerOpen(false)
  }

  const selectedStatus = homeownerStatus(selectedPayments)

  return (
    <div className="homeowners-page">
      <header className="homeowners-header">
        <div>
          <p className="homeowners-eyebrow">Secretary workspace</p>
          <h1>Homeowners</h1>
          <p>Search for a homeowner to view their profile, property, balances, and complete payment history.</p>
        </div>
        <button
          type="button"
          className="homeowners-refresh"
          onClick={() => loadHomeowners(true)}
          disabled={refreshing}
        >
          <RefreshCw size={17} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {pageError && <p className="homeowners-error">{pageError}</p>}

      <section className="homeowners-finder">
        <div className="homeowners-finder-heading">
          <div>
            <h2>Find a homeowner</h2>
            <span>{directoryEntries.length} registered lots</span>
          </div>
          <span className="homeowners-directory-icon"><Users size={19} /></span>
        </div>

        <div className="homeowners-finder-controls">
          <div className="homeowners-search-wrap" ref={searchWrapRef}>
            <label className="homeowners-search-label" htmlFor="homeowner-search">
              Search homeowners
            </label>
            <span className="homeowners-search-icon">
              <Search size={17} />
            </span>
            <input
              id="homeowner-search"
              type="search"
              className="homeowners-search"
              placeholder="Search by name, block, lot, phone, or email..."
              value={search}
              autoComplete="off"
              onFocus={() => setResultsOpen(true)}
              onChange={(event) => {
                setSearch(event.target.value)
                setResultsOpen(true)
              }}
              onKeyDown={handleSearchKeyDown}
            />

            {showResults && (
              <div className="homeowners-search-results" role="listbox">
                {loading ? (
                  <p className="homeowners-empty">Loading homeowners...</p>
                ) : filteredDirectory.length === 0 ? (
                  <p className="homeowners-empty">No matching homeowner found.</p>
                ) : (
                  filteredDirectory.map(({ property, status }) => (
                    <button
                      type="button"
                      key={property.id}
                      className={`homeowner-directory-card${
                        String(property.id) === String(selectedProperty?.id)
                          ? ' is-selected'
                          : ''
                      }`}
                      onClick={() => handleSelectHomeowner(property.id)}
                    >
                      <span className="homeowner-directory-avatar">
                        {initials(property.homeowner_name)}
                      </span>
                      <span className="homeowner-directory-copy">
                        <strong>{property.homeowner_name}</strong>
                        <small>{property.block} · Lot {property.lot_number}</small>
                        <span className={`homeowner-account-badge badge-${status.key}`}>
                          {status.label}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <select
            className="homeowners-filter"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value)
              setResultsOpen(true)
            }}
            aria-label="Filter homeowners by account status"
          >
            <option value="all">All account statuses</option>
            <option value="current">Current</option>
            <option value="balance">With balance</option>
            <option value="no-history">No payment history</option>
          </select>
        </div>
      </section>

      <main className="homeowner-profile-panel">
        {loading ? (
          <div className="homeowner-profile-empty">Loading homeowner profile...</div>
        ) : !selectedProperty ? (
          <div className="homeowner-profile-empty">
            <Users size={34} />
            <h2>{homeownerId ? 'Homeowner not found' : 'Search for a homeowner'}</h2>
            <p>
              {homeownerId
                ? 'This homeowner is no longer active in the directory.'
                : 'Use the search bar above to find someone by name, block, lot, phone, or email.'}
            </p>
          </div>
        ) : (
          <>
            <section className="homeowner-profile-hero">
              <div className="homeowner-profile-avatar">
                {initials(selectedProperty.homeowner_name)}
              </div>
              <div className="homeowner-profile-identity">
                <div className="homeowner-profile-title-row">
                  <div>
                    <p>Homeowner profile</p>
                    <h2>{selectedProperty.homeowner_name}</h2>
                  </div>
                  <span className={`homeowner-account-badge badge-${selectedStatus.key}`}>
                    {selectedStatus.label}
                  </span>
                </div>
                <div className="homeowner-profile-meta">
                  <span><Home size={16} /> {selectedProperty.block}, Lot {selectedProperty.lot_number}</span>
                  <span><Phone size={16} /> {selectedProperty.contact_phone || 'No phone recorded'}</span>
                  <span><Mail size={16} /> {selectedProperty.contact_email || 'No email recorded'}</span>
                </div>
              </div>
              <div className="homeowner-profile-actions">
                <button type="button" onClick={() => navigate('/contacts')}>
                  Edit Contact
                </button>
                <button type="button" onClick={() => navigate('/payments')}>
                  <CreditCard size={16} /> Record Payment
                </button>
               <button
                type="button"
                className={trackerOpen ? 'is-tracker-open' : ''}
                aria-expanded={trackerOpen}
                aria-controls="homeowner-payment-tracker"
                onClick={togglePaymentTracker}
                >
                <Calendar size={16} /> {trackerOpen ? 'Close Payment Tracker' : 'Open Payment Tracker'}
                </button>
              </div>
            </section>

            <section className="homeowner-summary-grid" aria-label="Financial summary">
              <article>
                <span>Total Paid</span>
                <strong>{peso.format(summary.totalPaid)}</strong>
                <small>All non-voided collections</small>
              </article>
              <article className={summary.outstanding > 0 ? 'has-balance' : ''}>
                <span>Current Balance</span>
                <strong>{peso.format(summary.outstanding)}</strong>
                <small>{summary.outstanding > 0 ? 'Payment still required' : 'No recorded balance'}</small>
              </article>
              <article>
                <span>Last Payment</span>
                <strong className="homeowner-summary-date">{summary.lastPayment}</strong>
                <small>Manila date and time</small>
              </article>
              <article>
                <span>Receipts</span>
                <strong>{summary.receipts}</strong>
                <small>Across all categories</small>
              </article>
            </section>

            {trackerOpen && (
              <div
                className="homeowner-tracker-overlay"
                onClick={closePaymentTracker}
              >
                <section
                  id="homeowner-payment-tracker"
                  ref={trackerRef}
                  className="homeowner-payment-tracker"
                  aria-label="Monthly and annual payment tracker"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="homeowner-tracker-close"
                    onClick={closePaymentTracker}
                    aria-label="Close payment tracker"
                  >
                    ×
                  </button>
                  <div className="homeowner-tracker-header">
                    <div className="homeowner-section-heading">
                      <Calendar size={18} />
                      <div>
                        <h3>Payment Tracker</h3>
                        <p>Monthly and annual payments recorded for this homeowner.</p>
                      </div>
                    </div>
                    <div className="homeowner-tracker-controls">
                      <div className="homeowner-tracker-switch" aria-label="Tracker view">
                        <button
                          type="button"
                          className={trackerView === 'monthly' ? 'is-active' : ''}
                          aria-pressed={trackerView === 'monthly'}
                          onClick={() => setTrackerView('monthly')}
                        >
                          Monthly
                        </button>
                        <button
                          type="button"
                          className={trackerView === 'annual' ? 'is-active' : ''}
                          aria-pressed={trackerView === 'annual'}
                          onClick={() => setTrackerView('annual')}
                        >
                          Annual
                        </button>
                      </div>
                      {trackerView === 'monthly' && (
                        <label className="homeowner-tracker-year">
                          <span>Year</span>
                          <select
                            value={trackerYear}
                            onChange={(event) => setTrackerYear(Number(event.target.value))}
                          >
                            {trackerYears.map((year) => (
                              <option key={year} value={year}>{year}</option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="homeowner-tracker-table-wrap">
                    {trackerView === 'monthly' ? (
                      <table className="homeowner-tracker-table">
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Status</th>
                            <th>Payments</th>
                            <th>Association Dues</th>
                            <th>Amenities &amp; Services</th>
                            <th>Other</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyTracker.map((month) => (
                            <tr key={month.month}>
                              <td><strong>{month.month}</strong></td>
                              <td>
                                <span className={`homeowner-tracker-status tracker-${month.status.key}`}>
                                  {month.status.label}
                                </span>
                              </td>
                              <td>{month.records.length}</td>
                              <td className="homeowner-number">{peso.format(month.dues)}</td>
                              <td className="homeowner-number">{peso.format(month.services)}</td>
                              <td className="homeowner-number">{peso.format(month.other)}</td>
                              <td className="homeowner-tracker-total">{peso.format(month.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="homeowner-tracker-table annual">
                        <thead>
                          <tr>
                            <th>Year</th>
                            <th>Months with Payments</th>
                            <th>Payments</th>
                            <th>Association Dues</th>
                            <th>Amenities &amp; Services</th>
                            <th>Other</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {annualTracker.map((year) => (
                            <tr key={year.year}>
                              <td><strong>{year.year}</strong></td>
                              <td>{year.months} of 12</td>
                              <td>{year.transactions}</td>
                              <td className="homeowner-number">{peso.format(year.dues)}</td>
                              <td className="homeowner-number">{peso.format(year.services)}</td>
                              <td className="homeowner-number">{peso.format(year.other)}</td>
                              <td className="homeowner-tracker-total">{peso.format(year.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <p className="homeowner-tracker-note">
                    Voided records are excluded. A blank month means no payment was recorded; it does not automatically mean an unpaid balance.
                  </p>
                </section>
              </div>
            )}

            <nav className="homeowner-tabs" aria-label="Homeowner profile sections">
              {[
                ['overview', 'Overview', history.length],
                ['dues', 'Association Dues', duesPayments.length],
                ['services', 'Amenities & Services', selectedServices.length],
                ['other', 'Other Payments', otherPayments.length],
              ].map(([key, label, count]) => (
                <button
                  type="button"
                  key={key}
                  className={activeTab === key ? 'is-active' : ''}
                  onClick={() => setActiveTab(key)}
                >
                  {label}<span>{count}</span>
                </button>
              ))}
            </nav>

            {activeTab === 'overview' && (
              <section className="homeowner-overview-grid">
                <article className="homeowner-info-card">
                  <div className="homeowner-section-heading">
                    <Home size={18} />
                    <div><h3>Property Information</h3><p>Registered property record</p></div>
                  </div>
                  <dl>
                    <div><dt>Homeowner</dt><dd>{selectedProperty.homeowner_name}</dd></div>
                    <div><dt>Block</dt><dd>{selectedProperty.block}</dd></div>
                    <div><dt>Lot</dt><dd>Lot {selectedProperty.lot_number}</dd></div>
                    <div><dt>Registered</dt><dd>{formatDate(selectedProperty.created_at, organization.dateFormat)}</dd></div>
                  </dl>
                </article>
                <article className="homeowner-info-card">
                  <div className="homeowner-section-heading">
                    <Phone size={18} />
                    <div><h3>Contact Information</h3><p>Homeowner communication details</p></div>
                  </div>
                  <dl>
                    <div><dt>Phone</dt><dd>{selectedProperty.contact_phone || 'Not provided'}</dd></div>
                    <div><dt>Email</dt><dd>{selectedProperty.contact_email || 'Not provided'}</dd></div>
                    <div><dt>Last updated</dt><dd>{formatDate(selectedProperty.contact_updated_at, organization.dateFormat)}</dd></div>
                  </dl>
                </article>
              </section>
            )}

            <section className="homeowner-history-card">
              <div className="homeowner-section-heading">
                {activeTab === 'services' ? <Calendar size={18} /> : <FileText size={18} />}
                <div>
                  <h3>{activeTab === 'overview' ? 'Recent Payment Activity' : 'Payment History'}</h3>
                  <p>Official receipts connected to this homeowner and property.</p>
                </div>
              </div>
              <div className="homeowner-history-table-wrap">
                <table className="homeowner-history-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Receipt</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Method</th>
                      <th>Amount</th>
                      <th>Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === 'overview' ? visibleHistory.slice(0, 8) : visibleHistory).length === 0 ? (
                      <tr><td colSpan="8" className="homeowners-empty">No payment records in this category.</td></tr>
                    ) : (
                      (activeTab === 'overview' ? visibleHistory.slice(0, 8) : visibleHistory).map((item) => (
                        <tr key={item.id}>
                          <td>{formatDate(item.paidAt, organization.dateFormat)}</td>
                          <td><strong>{item.receipt}</strong></td>
                          <td><span className={`homeowner-category category-${item.kind}`}>{item.category}</span></td>
                          <td>{item.description}</td>
                          <td>{item.method}</td>
                          <td className="homeowner-number">{peso.format(item.amount)}</td>
                          <td className={item.remaining > 0 ? 'homeowner-balance' : 'homeowner-number'}>{peso.format(item.remaining)}</td>
                          <td><span className={`homeowner-payment-status status-${normalize(item.status).replace(/\s+/g, '-')}`}>{item.status}</span></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}