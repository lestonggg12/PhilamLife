import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import './PaymentsPage.css'

const PAYMENT_PURPOSES = [
  'Association Dues',
  'Special Assessment',
  'Penalty / Late Fee',
  'Sticker / ID Fee',
  'Document / Certification Fee',
  'Other',
]

const EMPTY_FORM = {
  propertyId: '',
  homeownerName: '',
  blockName: '',
  lotNumber: '',
  paymentPurpose: '',
  customPaymentPurpose: '',
  coveragePeriod: '',
  previousBalance: '',
  amountPaid: '',
  paymentMethod: 'Cash',
  referenceNumber: '',
  note: '',
}

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

const paymentDate = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const paymentTime = new Intl.DateTimeFormat('en-PH', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Manila',
})

const chipDate = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CALENDAR_MONTH_LABEL = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

function pad2(value) {
  return String(value).padStart(2, '0')
}

function dateKeyOf(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

// Single source of truth for "what Manila calendar date is this JS
// Date on" — toManilaDateKey (payment timestamps) and manilaToday
// (the calendar's "today") both read through here.
function manilaDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const lookup = {}

  parts.forEach(({ type, value }) => {
    lookup[type] = value
  })

  return {
    year: Number(lookup.year),
    month: Number(lookup.month) - 1,
    day: Number(lookup.day),
  }
}

function toManilaDateKey(value) {
  if (!value) return ''

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) return ''

  const { year, month, day } = manilaDateParts(parsed)

  return dateKeyOf(year, month, day)
}

function manilaToday() {
  return manilaDateParts(new Date())
}

function buildCalendarWeeks(viewYear, viewMonth) {
  const firstOfMonth = new Date(viewYear, viewMonth, 1)
  const startWeekday = firstOfMonth.getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate()

  const cells = []

  for (let i = 0; i < startWeekday; i += 1) {
    const day = daysInPrevMonth - startWeekday + 1 + i
    const date = new Date(viewYear, viewMonth - 1, day)

    cells.push({
      day,
      outside: true,
      dateKey: dateKeyOf(date.getFullYear(), date.getMonth(), day),
    })
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      day,
      outside: false,
      dateKey: dateKeyOf(viewYear, viewMonth, day),
    })
  }

  const trailingCount = (7 - (cells.length % 7)) % 7

  for (let day = 1; day <= trailingCount; day += 1) {
    const date = new Date(viewYear, viewMonth + 1, day)

    cells.push({
      day,
      outside: true,
      dateKey: dateKeyOf(date.getFullYear(), date.getMonth(), day),
    })
  }

  const weeks = []

  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return weeks
}

function PaymentCalendar({
  selectedDateKey,
  activeDateKeys,
  onSelectDate,
}) {
  const manilaAnchor = manilaToday()

  const [viewYear, setViewYear] = useState(
    selectedDateKey
      ? Number(selectedDateKey.slice(0, 4))
      : manilaAnchor.year,
  )
  const [viewMonth, setViewMonth] = useState(
    selectedDateKey
      ? Number(selectedDateKey.slice(5, 7)) - 1
      : manilaAnchor.month,
  )

  const todayKey = dateKeyOf(
    manilaAnchor.year,
    manilaAnchor.month,
    manilaAnchor.day,
  )

  const weeks = useMemo(
    () => buildCalendarWeeks(viewYear, viewMonth),
    [viewYear, viewMonth],
  )

  function goToPrevMonth() {
    setViewMonth((month) => {
      if (month === 0) {
        setViewYear((year) => year - 1)
        return 11
      }

      return month - 1
    })
  }

  function goToNextMonth() {
    setViewMonth((month) => {
      if (month === 11) {
        setViewYear((year) => year + 1)
        return 0
      }

      return month + 1
    })
  }

  function jumpToToday() {
    const { year, month, day } = manilaToday()

    setViewYear(year)
    setViewMonth(month)
    onSelectDate(dateKeyOf(year, month, day))
  }

  return (
    <div
      className="payments-calendar-popover"
      role="dialog"
      aria-label="View payments by date"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="payments-calendar-nav">
        <button
          type="button"
          className="payments-calendar-nav-button"
          onClick={goToPrevMonth}
          aria-label="Previous month"
        >
          ‹
        </button>

        <span className="payments-calendar-title">
          {CALENDAR_MONTH_LABEL.format(new Date(viewYear, viewMonth, 1))}
        </span>

        <button
          type="button"
          className="payments-calendar-nav-button"
          onClick={goToNextMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="payments-calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      {weeks.map((week, weekIndex) => (
        <div className="payments-calendar-grid" key={`week-${weekIndex}`}>
          {week.map((cell) => {
            const isSelected = cell.dateKey === selectedDateKey
            const isToday = cell.dateKey === todayKey
            const hasPayments = activeDateKeys.has(cell.dateKey)

            const classNames = [
              'payments-calendar-day',
              cell.outside ? 'payments-calendar-day-outside' : '',
              isToday ? 'payments-calendar-day-today' : '',
              isSelected ? 'payments-calendar-day-selected' : '',
              hasPayments && !cell.outside
                ? 'payments-calendar-day-dot'
                : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <button
                type="button"
                key={cell.dateKey}
                className={classNames}
                onClick={() => onSelectDate(cell.dateKey)}
              >
                {cell.day}
              </button>
            )
          })}
        </div>
      ))}

      <div className="payments-calendar-legend">
        <span>
          <span className="payments-calendar-legend-today" />
          Today
        </span>

        <span>
          <span className="payments-calendar-legend-dot" />
          Has payments
        </span>
      </div>

      <button
        type="button"
        className="payments-calendar-jump"
        onClick={jumpToToday}
      >
        Jump to Today
      </button>
    </div>
  )
}

export default function PaymentsPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const location = useLocation()
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [payments, setPayments] = useState([])
  const [properties, setProperties] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [homeownerMenuOpen, setHomeownerMenuOpen] = useState(false)
  const [selectedDateKey, setSelectedDateKey] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarAnchorRef = useRef(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManagePayments =
    role === 'admin' || role === 'secretary' || role === 'treasurer'
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadPage()
    resolveCurrentUser()
  }, [])
  useEffect(() => {
   const prefill = location.state?.prefill
    if (!prefill) return

    setForm((current) => ({
    ...current,
     ...prefill,
   }))
   setShowForm(true)

   // Clear the navigation state so refresh/back doesn't re-trigger the prefill.
   navigate(location.pathname, { replace: true, state: {} })
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [location.state])

  useEffect(() => {
    if (!calendarOpen) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setCalendarOpen(false)
      }
    }

    function handleOutsideClick(event) {
      if (
        calendarAnchorRef.current &&
        !calendarAnchorRef.current.contains(event.target)
      ) {
        setCalendarOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleOutsideClick)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [calendarOpen])

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

  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [paymentResult, propertyResult] = await Promise.all([
      supabase
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false }),
      supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number')
        .order('homeowner_name'),
    ])

    if (paymentResult.error) {
      setPageError(`Could not load payments: ${paymentResult.error.message}`)
    } else {
      setPayments(paymentResult.data || [])
    }

    if (propertyResult.error) {
      setPageError((current) => {
        const message = `Could not load ledger homeowners: ${propertyResult.error.message}`
        return current ? `${current} ${message}` : message
      })
    } else {
      setProperties(propertyResult.data || [])
    }
    setLoading(false)
  }

  const remainingBalance = useMemo(() => {
    const previous = Number(form.previousBalance) || 0
    const paid = Number(form.amountPaid) || 0
    return Math.max(previous - paid, 0)
  }, [form.previousBalance, form.amountPaid])

  // Like Official Receipts, the payment history table stays empty
  // until the user actively searches or picks a date — no default
  // dump of every historical payment on page load.
  const filtersActive = Boolean(searchTerm || selectedDateKey)

  const filteredPayments = useMemo(() => {
    if (!filtersActive) return []

    const query = searchTerm.trim().toLowerCase()

    return payments.filter((payment) => {
      const matchesSearch =
        !query ||
        [
          payment.receipt_number,
          payment.homeowner_name,
          payment.block_name,
          payment.lot_number,
          payment.coverage_period,
          payment.payment_method,
          payment.status,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)

      const matchesDate =
        !selectedDateKey ||
        toManilaDateKey(payment.paid_at) === selectedDateKey

      return matchesSearch && matchesDate
    })
  }, [filtersActive, payments, searchTerm, selectedDateKey])

  const activeDateKeys = useMemo(() => {
    const keys = new Set()

    payments.forEach((payment) => {
      const key = toManilaDateKey(payment.paid_at)
      if (key) keys.add(key)
    })

    return keys
  }, [payments])

  const paymentSummary = useMemo(() => {
    const completed = payments.filter((payment) => payment.status !== 'Voided')
    const homeowners = new Set(
      completed.map((payment) => payment.property_id || `${payment.block_name}-${payment.lot_number}`),
    )

    return {
      collected: completed.reduce(
        (total, payment) => total + (Number(payment.amount_paid ?? payment.amount) || 0),
        0,
      ),
      completed: completed.length,
      homeowners: homeowners.size,
    }
  }, [payments])

  const matchingHomeowners = useMemo(() => {
    const search = form.homeownerName.trim().toLowerCase()

    return properties
      .filter((property) => {
        if (!search) return true

        const searchableValue = [
          property.homeowner_name,
          property.block,
          `Lot ${property.lot_number}`,
        ]
          .join(' ')
          .toLowerCase()

        return searchableValue.includes(search)
      })
      .slice(0, 8)
  }, [form.homeownerName, properties])

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  function updateHomeownerSearch(event) {
    const { value } = event.target

    setForm((current) => ({
      ...current,
      propertyId: '',
      homeownerName: value,
      blockName: '',
      lotNumber: '',
    }))
    setHomeownerMenuOpen(true)
    setFormError('')
  }

  function selectHomeowner(property) {
    setForm((current) => ({
      ...current,
      propertyId: String(property.id),
      homeownerName: property.homeowner_name,
      blockName: property.block,
      lotNumber: String(property.lot_number),
    }))
    setHomeownerMenuOpen(false)
    setFormError('')
  }

  function openForm() {
    if (!canManagePayments) return
    setForm(EMPTY_FORM)
    setFormError('')
    setHomeownerMenuOpen(false)
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setFormError('')
  }

  function handleSelectCalendarDate(dateKey) {
    setSelectedDateKey(dateKey)
    setCalendarOpen(false)
  }

  function clearDateFilter() {
    setSelectedDateKey('')
  }

  async function recordPayment(event) {
    event.preventDefault()

    if (!canManagePayments) {
      setFormError('Only an Admin, Secretary, or Treasurer can record payments.')
      return
    }

    if (!currentUser?.id) {
      setFormError('Your user profile could not be verified. Please sign in again.')
      return
    }

    const previous = Number(form.previousBalance)
    const paid = Number(form.amountPaid)
    const reference = form.referenceNumber.trim()
    const selectedPurpose =
      form.paymentPurpose === 'Other'
        ? form.customPaymentPurpose.trim()
        : form.paymentPurpose

    if (!form.propertyId || !form.homeownerName.trim() || !form.blockName || !form.lotNumber.trim()) {
      setFormError('Select a homeowner from the ledger list.')
      return
    }

    if (!selectedPurpose) {
      setFormError('Select or enter a payment purpose.')
      return
    }

    if (!form.coveragePeriod.trim()) {
      setFormError('Enter the coverage period or payment details.')
      return
    }

    if (!Number.isFinite(previous) || previous < 0) {
      setFormError('Previous balance must be zero or greater.')
      return
    }

    if (!Number.isFinite(paid) || paid <= 0) {
      setFormError('Amount paid must be greater than zero.')
      return
    }

    if (paid > previous) {
      setFormError('Amount paid cannot be greater than the previous balance.')
      return
    }

    if (form.paymentMethod !== 'Cash' && !reference) {
      setFormError('A reference number is required for non-cash payments.')
      return
    }

    setSaving(true)
    setFormError('')

    const payload = {
      property_id: Number(form.propertyId),
      homeowner_name: form.homeownerName.trim().replace(/\s+/g, ' '),
      block_name: form.blockName,
      lot_number: form.lotNumber.trim().replace(/\s+/g, ' '),
      coverage_period: `${selectedPurpose} — ${form.coveragePeriod.trim()}`.replace(/\s+/g, ' '),
      previous_balance: previous,
      amount: paid,
      amount_paid: paid,
      payment_method: form.paymentMethod,
      reference_number: reference || null,
      note: form.note.trim() || null,
      recorded_by: currentUser.id,
      recorded_by_name: recorderName,
    }

    const { data, error } = await supabase
      .from('payments')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setFormError(error.message)
      setSaving(false)
      return
    }

    const { error: activityError } = await supabase
      .from('activity_log')
      .insert({
        user_id: currentUser.id,
        action: 'Payment Recorded',
        target: `${data.receipt_number} — ${data.homeowner_name} — ${peso.format(
          data.amount_paid ?? data.amount,
        )}`,
      })

    if (activityError) {
      console.warn(
        'Payment saved, but activity logging failed:',
        activityError.message,
      )
    }

    setPayments((current) => [data, ...current])
    setShowForm(false)
    setForm(EMPTY_FORM)
    setReceipt(data)
    setSaving(false)
  }

  return (
    <div className="payments-page">
      <header className="payments-header">
        <div className="payments-header-copy">
          <div className="payments-header-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 9h18M7 15h3" />
            </svg>
          </div>
          <div>
            <span className="payments-eyebrow">Finance</span>
            <h1>Payments</h1>
            <p>Record homeowner collections and manage payment receipts.</p>
          </div>
        </div>

        <div className="payments-header-actions" ref={calendarAnchorRef}>
          <button
            type="button"
            className={`payments-date-toggle ${selectedDateKey ? 'is-active' : ''}`}
            onClick={() => setCalendarOpen((open) => !open)}
            aria-expanded={calendarOpen}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            View by Date
          </button>

          {canManagePayments && (
            <button className="payments-primary" type="button" onClick={openForm}>
              <span aria-hidden="true">+</span>
              Record Payment
            </button>
          )}

          {calendarOpen && (
            <PaymentCalendar
              selectedDateKey={selectedDateKey}
              activeDateKeys={activeDateKeys}
              onSelectDate={handleSelectCalendarDate}
            />
          )}
        </div>
      </header>

      {pageError && <p className="payments-error">{pageError}</p>}

      <section className="payments-summary" aria-label="Payment overview">
        <article className="payments-summary-card payments-summary-collected">
          <span className="payments-summary-label">Total collected</span>
          <strong>{peso.format(paymentSummary.collected)}</strong>
          <small>Excludes voided payments</small>
        </article>
        <article className="payments-summary-card payments-summary-records">
          <span className="payments-summary-label">Completed payments</span>
          <strong>{paymentSummary.completed}</strong>
          <small>{payments.length} total record{payments.length === 1 ? '' : 's'}</small>
        </article>
        <article className="payments-summary-card payments-summary-homeowners">
          <span className="payments-summary-label">Homeowners served</span>
          <strong>{paymentSummary.homeowners}</strong>
          <small>Unique properties collected</small>
        </article>
      </section>

      <section className="payments-table-card">
        <div className="payments-table-heading">
          <div>
            <h2>Payment history</h2>
            <p>
              {filtersActive
                ? 'Search and review recorded transactions.'
                : 'Search a name/receipt or pick a date to view transactions.'}
            </p>
          </div>
          <span className="payments-result-count">
            {filtersActive
              ? `${filteredPayments.length} ${filteredPayments.length === 1 ? 'record' : 'records'}`
              : `${payments.length} on file`}
          </span>
        </div>

        <div className="payments-table-toolbar">
          <div className="payments-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              className="payments-search-input"
              type="search"
              aria-label="Search payments"
              placeholder="Search receipt, homeowner, property, or payment details"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {searchTerm && (
              <button className="payments-search-clear" type="button" onClick={() => setSearchTerm('')}>
                Clear
              </button>
            )}
          </div>

          {selectedDateKey && (
            <span className="payments-date-chip">
              {organization.formatDate(`${selectedDateKey}T12:00:00`)}
              <button type="button" onClick={clearDateFilter} aria-label="Clear date filter">
                ×
              </button>
            </span>
          )}
        </div>

        <table className="payments-table">
          <thead>
            <tr>
              <th>Receipt / Date</th>
              <th>Homeowner / Property</th>
              <th>Payment details</th>
              <th>Amount / Method</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="payments-empty">Loading payments...</td></tr>
            ) : !filtersActive ? (
              <tr>
                <td colSpan="6" className="payments-empty">
                  <strong>Pick a date or search to view payments</strong>
                  <span>Use View by Date, or search by receipt, homeowner, or property above.</span>
                </td>
              </tr>
            ) : filteredPayments.length === 0 ? (
              <tr>
                <td colSpan="6" className="payments-empty">
                  <strong>No matching payments</strong>
                  <span>Try a different receipt, homeowner, payment detail, or date.</span>
                </td>
              </tr>
            ) : (
              filteredPayments.map((payment) => (
                <tr key={payment.id} className={payment.status === 'Voided' ? 'payments-row-voided' : ''}>
                  <td data-label="Receipt / Date">
                    <strong className="payments-receipt-number">{payment.receipt_number}</strong>
                    <small className="payments-secondary-text">
                      {organization.formatDate(payment.paid_at, { withTime: true })}
                    </small>
                  </td>
                  <td data-label="Homeowner / Property">
                    <span className="payments-primary-text">{payment.homeowner_name}</span>
                    <small className="payments-secondary-text">{payment.block_name} · Lot {payment.lot_number}</small>
                  </td>
                  <td data-label="Payment details">
                    <span className="payments-coverage" title={payment.coverage_period}>{payment.coverage_period}</span>
                  </td>
                  <td data-label="Amount / Method">
                    <strong className={`payments-amount ${payment.status === 'Voided' ? 'payments-amount-voided' : ''}`}>
                      {peso.format(Number(payment.amount_paid ?? payment.amount) || 0)}
                    </strong>
                    <small className="payments-secondary-text">{payment.payment_method}</small>
                  </td>
                  <td data-label="Status">
                    <span className={payment.status === 'Voided' ? 'payments-status-voided' : 'payments-status-completed'}>
                      {payment.status === 'Voided' ? 'Voided' : 'Completed'}
                    </span>
                  </td>
                  <td data-label="Receipt" className="payments-action-cell">
                    <button className="payments-link" type="button" onClick={() => setReceipt(payment)}>
                      View <span aria-hidden="true">→</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {showForm && canManagePayments && (
        <div className="payments-overlay" onMouseDown={closeForm}>
          <form className="payment-form" onSubmit={recordPayment} onMouseDown={(e) => e.stopPropagation()} autoComplete="off">
            <div className="payment-modal-heading">
              <div>
                <h2>Record Payment</h2>
                <p>Check every value before saving. Saved receipts should not be edited casually.</p>
              </div>
              <button type="button" className="payments-close" onClick={closeForm}>×</button>
            </div>

            <div className="payment-form-grid">
              <div className="payment-homeowner-field payment-span-2">
                <label htmlFor="payment-homeowner-search">Homeowner full name</label>
                <div className="payment-homeowner-combobox">
                  <input
                    id="payment-homeowner-search"
                    name="homeownerName"
                    type="search"
                    value={form.homeownerName}
                    onChange={updateHomeownerSearch}
                    onFocus={() => setHomeownerMenuOpen(true)}
                    onBlur={() => window.setTimeout(() => setHomeownerMenuOpen(false), 120)}
                    placeholder="Search homeowner name, block, or lot..."
                    maxLength="120"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={homeownerMenuOpen}
                    aria-controls="payment-homeowner-options"
                    required
                  />

                  {homeownerMenuOpen && (
                    <div className="payment-homeowner-options" id="payment-homeowner-options" role="listbox">
                      {loading ? (
                        <p className="payment-homeowner-empty">Loading ledger homeowners...</p>
                      ) : matchingHomeowners.length === 0 ? (
                        <p className="payment-homeowner-empty">No matching homeowner found in the ledger.</p>
                      ) : (
                        matchingHomeowners.map((property) => (
                          <button
                            type="button"
                            className={`payment-homeowner-option ${
                              String(property.id) === form.propertyId ? 'is-selected' : ''
                            }`}
                            key={property.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectHomeowner(property)}
                            role="option"
                            aria-selected={String(property.id) === form.propertyId}
                          >
                            <span>{property.homeowner_name}</span>
                            <small>{property.block} · Lot {property.lot_number}</small>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <small className="payment-homeowner-help">
                  Select a homeowner from the ledger to fill the property details.
                </small>
              </div>

              <label>Block
                <input
                  name="blockName"
                  value={form.blockName}
                  placeholder="Filled from ledger"
                  readOnly
                  required
                />
              </label>

              <label>Lot number
                <input
                  name="lotNumber"
                  value={form.lotNumber}
                  placeholder="Filled from ledger"
                  readOnly
                  required
                />
              </label>

              <label className="payment-purpose-field payment-span-2">
                Payment Purpose
                <div className="payment-purpose-select-wrap">
                  <select
                    name="paymentPurpose"
                    value={form.paymentPurpose}
                    onChange={updateField}
                    required
                  >
                    <option value="" disabled>Select payment purpose</option>
                    {PAYMENT_PURPOSES.map((purpose) => (
                      <option value={purpose} key={purpose}>
                        {purpose}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              {form.paymentPurpose === 'Other' && (
                <label className="payment-span-2">Other payment purpose
                  <input
                    name="customPaymentPurpose"
                    value={form.customPaymentPurpose}
                    onChange={updateField}
                    placeholder="Enter the payment purpose"
                    maxLength="80"
                    required
                  />
                </label>
              )}

              <label className="payment-span-2">Coverage Period / Payment Details
                <input
                  name="coveragePeriod"
                  value={form.coveragePeriod}
                  onChange={updateField}
                  placeholder="e.g., July 2026 or Homeowner ID renewal"
                  maxLength="120"
                  required
                />
              </label>

              <label>Previous balance
                <input name="previousBalance" type="number" min="0" step="0.01" value={form.previousBalance} onChange={updateField} required />
              </label>

              <label>Amount paid
                <input name="amountPaid" type="number" min="0.01" step="0.01" value={form.amountPaid} onChange={updateField} required />
              </label>

              <div className="payment-balance-preview payment-span-2">
                <span>Remaining balance after payment</span>
                <strong>{peso.format(remainingBalance)}</strong>
              </div>

              <label>Payment Method
                <select name="paymentMethod" value={form.paymentMethod} onChange={updateField}>
                  <option>Cash</option>
                  <option>GCash</option>
                  <option>Bank Transfer</option>
                  <option>Check</option>
                </select>
              </label>

              <label>Reference Number {form.paymentMethod !== 'Cash' && '*'}
                <input name="referenceNumber" value={form.referenceNumber} onChange={updateField} maxLength="100" required={form.paymentMethod !== 'Cash'} />
              </label>

              <label className="payment-span-2">Note (Optional)
                <textarea name="note" value={form.note} onChange={updateField} maxLength="250" rows="3" />
              </label>
            </div>

            {formError && <p className="payments-error">{formError}</p>}

            <div className="payment-actions">
              <button type="button" className="payments-secondary" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="submit" className="payments-primary" disabled={saving}>{saving ? 'Saving...' : 'Save and Create Receipt'}</button>
            </div>
          </form>
        </div>
      )}

      {receipt && (
        <div className="payments-overlay receipt-overlay" onMouseDown={() => setReceipt(null)}>
          <article className="receipt" onMouseDown={(e) => e.stopPropagation()}>
            <div className="receipt-copy">
              <header className="receipt-header">
                <div>
                  <h2>{organization.associationName}</h2>
                  <p>Official Payment Receipt</p>
                </div>
                <div className="receipt-number"><span>Receipt No.</span><strong>{receipt.receipt_number}</strong></div>
              </header>

              <dl className="receipt-details">
                <div><dt>Date and time</dt><dd>{organization.formatDate(receipt.paid_at, { withTime: true })}</dd></div>
                <div><dt>Received from</dt><dd>{receipt.homeowner_name}</dd></div>
                <div><dt>Property</dt><dd>{receipt.block_name}, {receipt.lot_number}</dd></div>
                <div><dt>Payment for</dt><dd>{receipt.coverage_period}</dd></div>
                <div><dt>Payment method</dt><dd>{receipt.payment_method}</dd></div>
                {receipt.reference_number && <div><dt>Reference no.</dt><dd>{receipt.reference_number}</dd></div>}
              </dl>

              <div className="receipt-totals">
                <div><span>Previous balance</span><span>{peso.format(receipt.previous_balance)}</span></div>
                <div className="receipt-paid"><strong>Amount paid</strong><strong>{peso.format(receipt.amount_paid)}</strong></div>
                <div><span>Remaining balance</span><strong>{peso.format(receipt.remaining_balance)}</strong></div>
              </div>

              {receipt.note && <p className="receipt-note"><strong>Note:</strong> {receipt.note}</p>}

              <footer className="receipt-footer">
                <div><span>Recorded by</span><strong>{receipt.recorded_by_name}</strong></div>
                <p>This computer-generated receipt is based on the payment saved in the system.</p>
              </footer>
            </div>

            <div className="receipt-actions">
              <button type="button" className="payments-secondary" onClick={() => setReceipt(null)}>Close</button>
              <button type="button" className="payments-primary" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </article>
        </div>
      )}
    </div>
  )
}