import React, { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle,
  CreditCard,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  X,
} from '../components/Icons'

// Small inline icons so this page doesn't depend on extra exports from
// components/Icons.jsx (Calendar / ChevronLeft / ChevronRight aren't there).
function CalendarIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ChevronLeftIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'
import './ServicesManagementPage.css'

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

const dayHeaderFormat = new Intl.DateTimeFormat('en-PH', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const monthTitleFormat = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const escapePrintText = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

function printServiceReceipt(receipt, associationName, onPopupBlocked) {
  const printWindow = window.open('', '_blank', 'width=900,height=700')

  if (!printWindow) {
    onPopupBlocked?.('Please allow pop-ups to print the service receipt.')
    return
  }

  const rows = [
    ['Received from', receipt.customer_name],
    ['Property', `${receipt.block_name}, Lot ${receipt.lot_number}`],
    ['Service', receipt.service_name],
    ['Service date', receipt.service_date],
    ['Amount paid', peso.format(Number(receipt.amount_paid) || 0)],
    ['Payment method', receipt.payment_method],
    ['Date issued', dateTime.format(new Date(receipt.paid_at))],
    ['Processed by', receipt.recorded_by_name],
  ]

  const receiptRows = rows
    .map(
      ([label, value]) => `
        <div class="receipt-row">
          <span>${escapePrintText(label)}</span>
          <strong>${escapePrintText(value)}</strong>
        </div>
      `,
    )
    .join('')

  printWindow.addEventListener(
    'load',
    () => {
      printWindow.focus()
      printWindow.print()
    },
    { once: true },
  )

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapePrintText(receipt.receipt_number)} - Official Service Receipt</title>
        <style>
          @page { size: A4 portrait; margin: 16mm; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #17324a;
            font-family: Arial, Helvetica, sans-serif;
          }
          .receipt {
            width: 100%;
            max-width: 700px;
            margin: 0 auto;
            padding: 22px 28px;
            border: 1px solid #dce8f0;
          }
          .check {
            display: grid;
            width: 44px;
            height: 44px;
            margin: 0 auto 12px;
            place-items: center;
            border-radius: 50%;
            background: #dcfce7;
            color: #15803d;
            font-size: 28px;
            font-weight: 700;
          }
          .association {
            margin: 0 0 6px;
            color: #5d7d98;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: .06em;
            text-align: center;
            text-transform: uppercase;
          }
          h1 {
            margin: 0;
            color: #071e30;
            font-size: 24px;
            text-align: center;
          }
          .number {
            display: block;
            margin: 12px 0 24px;
            color: #1464a0;
            font-size: 17px;
            text-align: right;
          }
          .receipt-details { border-top: 1px solid #dce8f0; }
          .receipt-row {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            padding: 12px 0;
            border-bottom: 1px solid #e7eff4;
          }
          .receipt-row span { color: #5d7d98; }
          .receipt-row strong {
            color: #071e30;
            text-align: right;
          }
          .note {
            margin: 20px 0 0;
            color: #7890a2;
            font-size: 11px;
            line-height: 1.5;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <div class="check">✓</div>
          <p class="association">${escapePrintText(associationName)}</p>
          <h1>Official Service Receipt</h1>
          <strong class="number">${escapePrintText(receipt.receipt_number)}</strong>
          <section class="receipt-details">${receiptRows}</section>
          <p class="note">
            This receipt is a permanent transaction record and cannot be deleted
            from the Services Management page.
          </p>
        </main>
      </body>
    </html>
  `)
  printWindow.document.close()
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

function isCurrentManilaMonth(value) {
  if (!value) return false
  const parts = (date) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
    }).format(date)

  return parts(new Date(value)) === parts(new Date())
}

// A YYYY-MM-DD string, treated as a fixed calendar day (no timezone drift).
function dayLabel(dateKey) {
  return dayHeaderFormat.format(new Date(`${dateKey}T12:00:00+08:00`))
}

// Builds a Sun-start month grid of YYYY-MM-DD keys for the given year/month
// (month is 0-11), padded with the surrounding month's days.
function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(Date.UTC(year, month, 1))
  const startWeekday = firstOfMonth.getUTCDay()
  const gridStart = new Date(firstOfMonth)
  gridStart.setUTCDate(gridStart.getUTCDate() - startWeekday)

  const cells = []
  for (let i = 0; i < 42; i += 1) {
    const cellDate = new Date(gridStart)
    cellDate.setUTCDate(gridStart.getUTCDate() + i)
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(cellDate)
    cells.push({
      key,
      day: cellDate.getUTCDate(),
      inMonth: cellDate.getUTCMonth() === month,
    })
  }
  return cells
}

const emptyService = {
  name: '',
  description: '',
  rate: '',
  rate_unit: 'per use',
  is_active: true,
}

const emptyTransaction = {
  service_id: '',
  property_id: '',
  service_date: today(),
  start_time: '',
  quantity: '1',
  amount_paid: '',
  payment_method: 'Cash',
  reference_number: '',
  notes: '',
}

export default function ServicesManagementPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [popupNotice, setPopupNotice] = useState('')
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [services, setServices] = useState([])
  const [transactions, setTransactions] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [editingServiceId, setEditingServiceId] = useState(null)
  const [serviceForm, setServiceForm] = useState(emptyService)
  const [transactionForm, setTransactionForm] = useState(emptyTransaction)
  const [receipt, setReceipt] = useState(null)

  // --- Calendar day-modal state (calendar lives beside "Record Payment";
  // picking an exact date opens a floating statement-style modal) ---
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const [year, month] = today().split('-').map(Number)
    return { year, month: month - 1 }
  })
  const [dayModalDate, setDayModalDate] = useState(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageServices = role === 'secretary'
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Secretary'

  useEffect(() => {
    loadPage()
    resolveCurrentUser()
  }, [])

  useEffect(() => {
    if (!calendarOpen) return undefined
    function handleClickAway(event) {
      if (!event.target.closest('.services-calendar-wrap')) {
        setCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [calendarOpen])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) return

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!error) setCurrentUser(profile)
  }

  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [serviceResult, transactionResult, propertyResult] = await Promise.all([
      supabase.from('amenity_services').select('*').order('name'),
      supabase
        .from('service_transactions')
        .select('*')
        .order('paid_at', { ascending: false }),
      supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number, homeowner_status')
        .order('homeowner_name'),
    ])

    const errors = [
      serviceResult.error,
      transactionResult.error,
      propertyResult.error,
    ].filter(Boolean)

    if (errors.length) {
      setPageError(
        `Some service records could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setServices(serviceResult.data || [])
    setTransactions(transactionResult.data || [])
    setProperties(propertyResult.data || [])
    setLoading(false)
  }

  const activeServices = useMemo(
    () => services.filter((service) => service.is_active),
    [services],
  )

  const summary = useMemo(() => {
    const thisMonth = transactions.filter((item) =>
      isCurrentManilaMonth(item.paid_at),
    )

    return {
      activeServices: activeServices.length,
      monthlyTransactions: thisMonth.length,
      monthlyCollections: thisMonth.reduce(
        (sum, item) => sum + (Number(item.amount_paid) || 0),
        0,
      ),
      receipts: transactions.length,
    }
  }, [activeServices, transactions])

  // Every calendar day that has at least one transaction, keyed by
  // service_date (YYYY-MM-DD) — drives the "has activity" dots.
  const activityDates = useMemo(() => {
    const set = new Set()
    transactions.forEach((item) => {
      if (item.service_date) set.add(item.service_date)
    })
    return set
  }, [transactions])

  // Transactions shown inside the floating day modal, once a specific date
  // has been picked from the calendar.
  const dayModalTransactions = useMemo(() => {
    if (!dayModalDate) return []
    return transactions
      .filter((item) => item.service_date === dayModalDate)
      .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
  }, [transactions, dayModalDate])

  const dayModalTotal = useMemo(
    () => dayModalTransactions.reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0),
    [dayModalTransactions],
  )

  const monthGrid = useMemo(
    () => buildMonthGrid(calendarCursor.year, calendarCursor.month),
    [calendarCursor],
  )

  function openCalendar() {
    const [year, month] = today().split('-').map(Number)
    setCalendarCursor({ year, month: month - 1 })
    setCalendarOpen((open) => !open)
  }

  function changeCalendarMonth(delta) {
    setCalendarCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1))
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() }
    })
  }

  function pickDay(dateKey) {
    setCalendarOpen(false)
    setDayModalDate(dateKey)
  }

  function jumpToToday() {
    const now = today()
    const [year, month] = now.split('-').map(Number)
    setCalendarCursor({ year, month: month - 1 })
  }

  const selectedService = services.find(
    (service) => service.id === transactionForm.service_id,
  )
  const amountDue =
    (Number(selectedService?.rate) || 0) *
    Math.max(Number(transactionForm.quantity) || 1, 1)

  function openPaymentForm(service = null) {
    if (!canManageServices) return

    const chosen = service || activeServices[0]
    setTransactionForm({
      ...emptyTransaction,
      service_date: today(),
      service_id: chosen?.id || '',
      amount_paid: chosen?.rate ? String(chosen.rate) : '',
    })
    setShowPaymentForm(true)
  }

  function openServiceForm(service = null) {
    setEditingServiceId(service?.id || null)
    setServiceForm(
      service
        ? {
            name: service.name,
            description: service.description || '',
            rate: String(service.rate),
            rate_unit: service.rate_unit,
            is_active: service.is_active,
          }
        : emptyService,
    )
    setShowServiceForm(true)
  }

  function handleServiceChange(event) {
    const service = services.find((item) => item.id === event.target.value)
    setTransactionForm((current) => ({
      ...current,
      service_id: event.target.value,
      amount_paid: service?.rate ? String(service.rate) : '',
    }))
  }

  async function saveService(event) {
    event.preventDefault()
    if (!canManageServices || !currentUser?.id) {
      setPageError('Only a verified Secretary can add an amenity or service.')
      return
    }

    setSaving(true)
    setPageError('')

    const payload = {
      name: serviceForm.name.trim(),
      description: serviceForm.description.trim() || null,
      rate: Number(serviceForm.rate),
      rate_unit: serviceForm.rate_unit,
      is_active: serviceForm.is_active,
    }

    const query = editingServiceId
      ? supabase
          .from('amenity_services')
          .update(payload)
          .eq('id', editingServiceId)
      : supabase
          .from('amenity_services')
          .insert({ ...payload, created_by: currentUser.id })

    const { data, error } = await query.select('*').single()

    if (error) {
      setPageError(error.message)
      setSaving(false)
      return
    }

    setServices((current) => {
      const updated = editingServiceId
        ? current.map((item) => (item.id === data.id ? data : item))
        : [...current, data]
      return updated.sort((left, right) => left.name.localeCompare(right.name))
    })
    setServiceForm(emptyService)
    setEditingServiceId(null)
    setShowServiceForm(false)
    setSaving(false)

    await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: editingServiceId ? 'Service Updated' : 'Service Added',
      target: `${data.name} (${recorderName})`,
    })
  }

  async function saveTransaction(event) {
    event.preventDefault()
    if (!canManageServices || !currentUser?.id) {
      setPageError('Only a verified Secretary can record service payments.')
      return
    }

    const property = properties.find(
      (item) => String(item.id) === transactionForm.property_id,
    )
    const service = services.find(
      (item) => item.id === transactionForm.service_id,
    )

    if (!property || !service) {
      setPageError('Select a valid homeowner and service.')
      return
    }

    const paid = Number(transactionForm.amount_paid)

    if (!Number.isFinite(paid) || paid <= 0) {
      setPageError('Enter a payment amount greater than zero.')
      return
    }

    setSaving(true)
    setPageError('')

    const payload = {
      property_id: Number(property.id),
      service_id: service.id,
      service_name: service.name,
      customer_name: property.homeowner_name,
      block_name: property.block,
      lot_number: String(property.lot_number),
      service_date: transactionForm.service_date,
      start_time: transactionForm.start_time || null,
      quantity: Math.max(Number(transactionForm.quantity) || 1, 1),
      amount_due: amountDue,
      amount_paid: paid,
      payment_method: transactionForm.payment_method,
      reference_number: transactionForm.reference_number.trim() || null,
      notes: transactionForm.notes.trim() || null,
      payment_status: paid >= amountDue ? 'paid' : 'partial',
      recorded_by: currentUser.id,
      recorded_by_name: recorderName,
    }

    const { data, error } = await supabase
      .from('service_transactions')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setPageError(error.message)
      setSaving(false)
      return
    }

    setTransactions((current) => [data, ...current])
    setTransactionForm(emptyTransaction)
    setShowPaymentForm(false)
    setReceipt(data)
    setSaving(false)
    // Jump the calendar view to the day the new payment was recorded for,
    // so the freshly-created receipt is visible in the day's list.
    setDayModalDate(data.service_date)

    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: 'Service Payment Recorded',
      target: `${data.receipt_number} — ${data.service_name} for ${data.customer_name}`,
    })

    if (activityError) {
      console.warn('Service saved, but activity logging failed:', activityError.message)
    }
  }

  return (
    <div className="services-page">
      <header className="services-header">
        <div>
          <p className="services-eyebrow">Secretary workspace</p>
          <h1>Services Management</h1>
          <p>Manage village amenities, process service payments, and issue receipts.</p>
        </div>

        <div className="services-header-actions">
          <button
            type="button"
            className="services-button services-button-secondary"
            onClick={loadPage}
            disabled={loading}
          >
            <RefreshCw size={17} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          {canManageServices && (
            <>
              <button
                type="button"
                className="services-button services-button-secondary"
                onClick={() => openServiceForm()}
              >
                <Plus size={17} /> Add Service
              </button>

              <div className="services-calendar-wrap">
                <button
                  type="button"
                  className="services-button services-button-secondary day-picker-trigger"
                  onClick={openCalendar}
                  aria-haspopup="dialog"
                  aria-expanded={calendarOpen}
                >
                  <CalendarIcon size={17} /> View by Date
                </button>

                {calendarOpen && (
                  <div className="services-calendar-popover" role="dialog" aria-label="Choose a day">
                    <div className="services-calendar-nav">
                      <button type="button" onClick={() => changeCalendarMonth(-1)} aria-label="Previous month">
                        <ChevronLeftIcon size={16} />
                      </button>
                      <strong>{monthTitleFormat.format(new Date(Date.UTC(calendarCursor.year, calendarCursor.month, 1)))}</strong>
                      <button type="button" onClick={() => changeCalendarMonth(1)} aria-label="Next month">
                        <ChevronRightIcon size={16} />
                      </button>
                    </div>

                    <div className="services-calendar-weekdays">
                      {WEEKDAY_LABELS.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>

                    <div className="services-calendar-grid">
                      {monthGrid.map((cell) => (
                        <button
                          type="button"
                          key={cell.key}
                          className={[
                            'calendar-cell',
                            !cell.inMonth && 'outside-month',
                            cell.key === dayModalDate && 'selected',
                            cell.key === today() && 'is-today',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => pickDay(cell.key)}
                        >
                          {cell.day}
                          {activityDates.has(cell.key) && <span className="activity-dot" />}
                        </button>
                      ))}
                    </div>

                    <div className="services-calendar-footer">
                      <span><span className="legend-dot today-dot" /> Today</span>
                      <span><span className="legend-dot activity-legend-dot" /> Has activity</span>
                      <button type="button" onClick={jumpToToday}>Jump to today</button>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="services-button services-button-primary"
                onClick={() => openPaymentForm()}
                disabled={activeServices.length === 0}
              >
                <CreditCard size={17} /> Record Payment
              </button>
            </>
          )}
        </div>
      </header>

      {pageError && <p className="services-error">{pageError}</p>}
      {!loading && !canManageServices && (
        <p className="services-notice">
          You have view-only access. Service management and payment actions are
          restricted to the Secretary.
        </p>
      )}

      <section className="services-summary" aria-label="Service summaries">
        <article>
          <span>Active Services</span>
          <strong>{loading ? '—' : summary.activeServices}</strong>
          <small>Available village amenities</small>
        </article>
        <article>
          <span>Transactions This Month</span>
          <strong>{loading ? '—' : summary.monthlyTransactions}</strong>
          <small>Service payments recorded</small>
        </article>
        <article>
          <span>Collections This Month</span>
          <strong>{loading ? '—' : peso.format(summary.monthlyCollections)}</strong>
          <small>Based on Manila time</small>
        </article>
        <article>
          <span>Receipts Issued</span>
          <strong>{loading ? '—' : summary.receipts}</strong>
          <small>Permanent service records</small>
        </article>
      </section>

      <section className="service-catalog">
        <div className="services-section-heading">
          <div>
            <h2>Amenities & Services</h2>
            <p>Select an active amenity to record a payment.</p>
          </div>
        </div>

        {loading ? (
          <div className="services-state">Loading services...</div>
        ) : services.length === 0 ? (
          <div className="services-state">No services have been added yet.</div>
        ) : (
          <div className="service-card-grid">
            {services.map((service) => (
              <article
                className={`service-card${service.is_active ? '' : ' service-card-inactive'}`}
                key={service.id}
              >
                <div className="service-card-top">
                  <span className="service-card-icon"><FileText size={19} /></span>
                  <span className={`service-status ${service.is_active ? 'active' : 'inactive'}`}>
                    {service.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3>{service.name}</h3>
                <p>{service.description || 'Village amenity or service.'}</p>
                <div className="service-rate">
                  <strong>{peso.format(Number(service.rate) || 0)}</strong>
                  <span>{service.rate_unit}</span>
                </div>
                {canManageServices && (
                  <div className="service-card-actions">
                    <button type="button" onClick={() => openServiceForm(service)}>
                      Edit
                    </button>
                    {service.is_active && (
                      <button type="button" onClick={() => openPaymentForm(service)}>
                        Record payment
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {showServiceForm && (
        <div className="services-modal-backdrop" role="presentation">
          <form className="services-modal" onSubmit={saveService}>
            <div className="services-modal-header">
              <div>
                <h2>{editingServiceId ? 'Edit Amenity or Service' : 'Add Amenity or Service'}</h2>
                <p>Set its standard rate and availability.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowServiceForm(false)
                  setEditingServiceId(null)
                }}
                aria-label="Close"
              >
                <X size={19} />
              </button>
            </div>
            <label>
              Service name
              <input
                required
                value={serviceForm.name}
                onChange={(event) =>
                  setServiceForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </label>
            <label>
              Description
              <textarea
                rows="3"
                value={serviceForm.description}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <div className="services-form-row">
              <label>
                Standard rate
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={serviceForm.rate}
                  onChange={(event) =>
                    setServiceForm((current) => ({ ...current, rate: event.target.value }))
                  }
                />
              </label>
              <label>
                Rate unit
                <select
                  value={serviceForm.rate_unit}
                  onChange={(event) =>
                    setServiceForm((current) => ({
                      ...current,
                      rate_unit: event.target.value,
                    }))
                  }
                >
                  <option>per use</option>
                  <option>per hour</option>
                  <option>per person</option>
                  <option>per day</option>
                </select>
              </label>
            </div>
            <label className="services-checkbox">
              <input
                type="checkbox"
                checked={serviceForm.is_active}
                onChange={(event) =>
                  setServiceForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active and available for new payments
            </label>
            <div className="services-modal-actions">
              <button
                type="button"
                onClick={() => {
                  setShowServiceForm(false)
                  setEditingServiceId(null)
                }}
              >
                Cancel
              </button>
              <button type="submit" disabled={saving}>
                {saving
                  ? 'Saving...'
                  : editingServiceId
                    ? 'Save Changes'
                    : 'Add Service'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showPaymentForm && (
        <div className="services-modal-backdrop" role="presentation">
          <form className="services-modal services-payment-modal" onSubmit={saveTransaction}>
            <div className="services-modal-header">
              <div>
                <h2>Record Service Payment</h2>
                <p>The payment receipt is created only after a successful save.</p>
              </div>
              <button type="button" onClick={() => setShowPaymentForm(false)} aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <div className="services-form-row">
              <label>
                Service
                <select
                  required
                  value={transactionForm.service_id}
                  onChange={handleServiceChange}
                >
                  <option value="">Select service</option>
                  {activeServices.map((service) => (
                    <option value={service.id} key={service.id}>{service.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Homeowner
                <select
                  required
                  value={transactionForm.property_id}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      property_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select homeowner</option>
                  {properties
                    .filter((property) => (property.homeowner_status || 'active') === 'active')
                    .map((property) => (
                    <option value={String(property.id)} key={property.id}>
                      {property.homeowner_name} — {property.block}, Lot {property.lot_number}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="services-form-row services-form-row-three">
              <label>
                Service date
                <input
                  required
                  type="date"
                  value={transactionForm.service_date}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      service_date: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Start time
                <input
                  type="time"
                  value={transactionForm.start_time}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      start_time: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Quantity
                <input
                  required
                  min="1"
                  type="number"
                  value={transactionForm.quantity}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <div className="services-amount-due">
              <span>Amount due</span>
              <strong>{peso.format(amountDue)}</strong>
            </div>

            <div className="services-form-row">
              <label>
                Amount paid
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={transactionForm.amount_paid}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      amount_paid: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Payment method
                <select
                  value={transactionForm.payment_method}
                  onChange={(event) =>
                    setTransactionForm((current) => ({
                      ...current,
                      payment_method: event.target.value,
                    }))
                  }
                >
                  <option>Cash</option>
                  <option>GCash</option>
                  <option>Bank Transfer</option>
                  <option>Check</option>
                </select>
              </label>
            </div>

            <label>
              Reference number
              <input
                value={transactionForm.reference_number}
                onChange={(event) =>
                  setTransactionForm((current) => ({
                    ...current,
                    reference_number: event.target.value,
                  }))
                }
                placeholder="Optional for cash payments"
              />
            </label>
            <label>
              Notes
              <textarea
                rows="2"
                value={transactionForm.notes}
                onChange={(event) =>
                  setTransactionForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </label>
            <div className="services-modal-actions">
              <button type="button" onClick={() => setShowPaymentForm(false)}>
                Cancel
              </button>
              <button type="submit" disabled={saving || amountDue <= 0 || !(Number(transactionForm.amount_paid) > 0)}>
                {saving ? 'Saving...' : 'Save & Issue Receipt'}
              </button>
            </div>
          </form>
        </div>
      )}

      {receipt && (
        <div className="services-modal-backdrop" role="presentation">
          <article className="service-receipt">
            <div className="receipt-success"><CheckCircle size={24} /></div>
            <p className="receipt-kicker">{organization.associationName}</p>
            <h2>Official Service Receipt</h2>
            <strong className="receipt-number">{receipt.receipt_number}</strong>
            <dl>
              <div><dt>Received from</dt><dd>{receipt.customer_name}</dd></div>
              <div><dt>Property</dt><dd>{receipt.block_name}, Lot {receipt.lot_number}</dd></div>
              <div><dt>Service</dt><dd>{receipt.service_name}</dd></div>
              <div><dt>Service date</dt><dd>{receipt.service_date}</dd></div>
              <div><dt>Amount paid</dt><dd>{peso.format(Number(receipt.amount_paid) || 0)}</dd></div>
              <div><dt>Payment method</dt><dd>{receipt.payment_method}</dd></div>
              <div><dt>Date issued</dt><dd>{dateTime.format(new Date(receipt.paid_at))}</dd></div>
              <div><dt>Processed by</dt><dd>{receipt.recorded_by_name}</dd></div>
            </dl>
            <p className="receipt-note">
              This receipt is a permanent transaction record and cannot be deleted
              from the Services Management page.
            </p>
            <div className="services-modal-actions">
              <button type="button" onClick={() => setReceipt(null)}>Close</button>
              <button type="button" onClick={() => printServiceReceipt(receipt, organization.associationName, setPopupNotice)}>
                Print Receipt
              </button>
            </div>
          </article>
        </div>
      )}

      {dayModalDate && (
        <div className="services-modal-backdrop" role="presentation">
          <article className="day-modal">
            <div className="day-modal-header">
              <div>
                <p className="services-eyebrow">Service transactions</p>
                <h2>{dayLabel(dayModalDate)}</h2>
                <span className={`day-badge ${dayModalDate === today() ? 'current' : 'archived'}`}>
                  {dayModalDate === today() ? 'CURRENT DAY' : 'ARCHIVED DAY'}
                </span>
              </div>
              <button type="button" onClick={() => setDayModalDate(null)} aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <div className="day-modal-stats">
              <div>
                <span>Transactions</span>
                <strong>{dayModalTransactions.length}</strong>
              </div>
              <div>
                <span>Amount collected</span>
                <strong>{peso.format(dayModalTotal)}</strong>
              </div>
            </div>

            <div className="day-modal-list">
              {dayModalTransactions.length === 0 ? (
                <p className="services-day-empty">No service transactions recorded on this day.</p>
              ) : (
                dayModalTransactions.map((item) => (
                  <div className="day-modal-row" key={item.id}>
                    <div className="day-modal-row-main">
                      <strong>{item.receipt_number}</strong>
                      <span>{item.service_name}</span>
                    </div>
                    <div className="day-modal-row-meta">
                      <span>{item.customer_name} — {item.block_name}, Lot {item.lot_number}</span>
                      {item.start_time && <span>{item.start_time.slice(0, 5)}</span>}
                    </div>
                    <div className="day-modal-row-end">
                      <strong>{peso.format(Number(item.amount_paid) || 0)}</strong>
                      <span className={`payment-status ${item.payment_status}`}>{item.payment_status}</span>
                      <button
                        type="button"
                        className="receipt-link"
                        onClick={() => {
                          setReceipt(item)
                          setDayModalDate(null)
                        }}
                      >
                        <Eye size={16} /> Receipt
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="services-modal-actions">
              <button type="button" onClick={() => setDayModalDate(null)}>Close</button>
            </div>
          </article>
        </div>
      )}

      <ActionDialog
        open={!!popupNotice}
        title="Pop-up Blocked"
        message={popupNotice}
        onConfirm={() => setPopupNotice('')}
      />
    </div>
  )
}