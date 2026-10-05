import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { fetchAll } from '../lib/fetchAll'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'
import './ServicesManagementPage.css'
import useAnimatedPopover from '../hooks/useAnimatedPopover'

// Search-and-select homeowner field. Filters by name, block and lot;
// supports keyboard (arrows / Enter / Esc) and keeps native form validation.
const HOMEOWNER_RESULT_LIMIT = 50

function homeownerLabel(property) {
  return `${property.homeowner_name} — ${property.block}, Lot ${property.lot_number}`
}

function HomeownerCombobox({ properties, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = useMemo(
    () => properties.find((property) => String(property.id) === value) || null,
    [properties, value],
  )

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return properties
      .filter((property) => (property.homeowner_status || 'active') === 'active')
      .filter((property) => {
        if (!terms.length) return true
        const haystack = [
          property.homeowner_name,
          property.block,
          `lot ${property.lot_number}`,
          property.lot_number,
        ]
          .join(' ')
          .toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
  }, [properties, query])

  const visible = matches.slice(0, HOMEOWNER_RESULT_LIMIT)

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      value ? '' : 'Search and select a homeowner from the list.',
    )
  }, [value])

  useEffect(() => {
    if (!open) return undefined
    function handleClickAway(event) {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [open])

  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  function choose(property) {
    onChange(String(property.id))
    setOpen(false)
    setQuery('')
  }

  function clear() {
    onChange('')
    setQuery('')
    setOpen(true)
    inputRef.current?.focus()
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, visible.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && open) {
      event.preventDefault()
      if (visible[activeIndex]) choose(visible[activeIndex])
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div className="services-combobox-field">
      <label htmlFor="services-homeowner-input">Homeowner</label>
      <div className="services-combobox" ref={wrapRef}>
        <input
          id="services-homeowner-input"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls="services-homeowner-list"
          aria-autocomplete="list"
          autoComplete="off"
          required
          placeholder="Search name, block or lot"
          value={open ? query : selected ? homeownerLabel(selected) : query}
          onFocus={() => {
            setOpen(true)
            setActiveIndex(0)
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActiveIndex(0)
            if (value) onChange('')
          }}
          onKeyDown={handleKeyDown}
        />
        {value && (
          <button
            type="button"
            className="services-combobox-clear"
            aria-label="Clear homeowner"
            onClick={clear}
          >
            <X size={14} />
          </button>
        )}
        {open && (
          <ul
            className="services-combobox-list"
            id="services-homeowner-list"
            role="listbox"
            ref={listRef}
          >
            {visible.length === 0 && (
              <li className="services-combobox-empty">No matching homeowner</li>
            )}
            {visible.map((property, index) => (
              <li key={property.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={String(property.id) === value}
                  className={`services-combobox-option${
                    index === activeIndex ? ' is-active' : ''
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(property)}
                >
                  <strong>{property.homeowner_name}</strong>
                  <span>
                    {property.block}, Lot {property.lot_number}
                  </span>
                </button>
              </li>
            ))}
            {matches.length > HOMEOWNER_RESULT_LIMIT && (
              <li className="services-combobox-empty">
                Showing first {HOMEOWNER_RESULT_LIMIT} of {matches.length} — keep typing to narrow
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

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
  if (receipt.notes) rows.push(['Notes', receipt.notes])

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

// Manila-time start and end of a 'YYYY-MM' month, for database range queries.
function monthRangeOf(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    from: `${monthKey}-01T00:00:00+08:00`,
    to: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
    dateFrom: `${monthKey}-01`,
    dateTo: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
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

const emptyCollect = { amount: '', payment_method: 'Cash', reference_number: '', notes: '' }

// Money is stored in whole centavos; round typed/calculated amounts the same way
// so what staff see on screen is exactly what gets saved.
const toCents = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export default function ServicesManagementPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [popupNotice, setPopupNotice] = useState('')
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [services, setServices] = useState([])
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

  // Totals for the current month and overall come from small database queries;
  // the page never downloads the full list of service receipts.
  const [stats, setStats] = useState({ monthCount: 0, monthCollected: 0, totalReceipts: 0 })
  const [balances, setBalances] = useState([])
  const [collectTarget, setCollectTarget] = useState(null)
  const [collectForm, setCollectForm] = useState(emptyCollect)
  const [collectError, setCollectError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  // --- Calendar day-modal state (calendar lives beside "Record Payment";
  // picking an exact date opens a floating statement-style modal) ---
  const calendar = useAnimatedPopover()
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const [year, month] = today().split('-').map(Number)
    return { year, month: month - 1 }
  })
  const [dayModalDate, setDayModalDate] = useState(null)
  const [dayRows, setDayRows] = useState([])
  const [dayLoading, setDayLoading] = useState(false)
  const [activityByMonth, setActivityByMonth] = useState({})
  const loadedMonthsRef = useRef(new Set())

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageServices = role === 'secretary'
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Secretary'

  useEffect(() => {
    loadPage()
    resolveCurrentUser()
  }, [])

  useEffect(() => {
    if (!receipt) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [receipt])

  useEffect(() => {
    if (!calendar.open) return undefined
    function handleClickAway(event) {
      if (!event.target.closest('.services-calendar-wrap')) {
        calendar.hide()
      }
    }
    document.addEventListener('mousedown', handleClickAway)
    return () => document.removeEventListener('mousedown', handleClickAway)
  }, [calendar.open])

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

  // Catalog + homeowners (small lists). Totals and balances load separately.
  async function loadPage() {
    setLoading(true)
    setPageError('')

    const [serviceResult, propertyResult] = await Promise.all([
      supabase.from('amenity_services').select('*').order('name'),
      fetchAll(() => supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number, homeowner_status')
        .order('homeowner_name')),
    ])

    const errors = [serviceResult.error, propertyResult.error].filter(Boolean)
    if (errors.length) {
      setPageError(
        `Some service records could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setServices(serviceResult.data || [])
    setProperties(propertyResult.data || [])
    setReloadTick((tick) => tick + 1)
    setLoading(false)
  }

  // This month's totals, the all-time receipt count and the unpaid balances.
  useEffect(() => {
    let cancelled = false

    async function loadStats() {
      const range = monthRangeOf(today().slice(0, 7))
      const [summaryResult, countResult, balanceResult] = await Promise.all([
        supabase.rpc('receipts_period_summary', { p_from: range.from, p_to: range.to }),
        supabase.from('service_transactions').select('id', { count: 'exact', head: true }),
        supabase
          .from('service_balances')
          .select('*')
          .order('paid_at', { ascending: true })
          .limit(200),
      ])
      if (cancelled) return

      const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data
      setStats({
        monthCount: Number(summaryRow?.service_count) || 0,
        monthCollected: Number(summaryRow?.service_collected) || 0,
        totalReceipts: countResult.count || 0,
      })
      setBalances(balanceResult.error ? [] : balanceResult.data || [])
    }

    loadStats()
    return () => { cancelled = true }
  }, [reloadTick])

  const activeServices = useMemo(
    () => services.filter((service) => service.is_active),
    [services],
  )

  const balanceById = useMemo(
    () => new Map(balances.map((row) => [row.id, row])),
    [balances],
  )
  const totalUnpaid = useMemo(
    () => toCents(balances.reduce((sum, row) => sum + (Number(row.balance_due) || 0), 0)),
    [balances],
  )

  const summary = {
    activeServices: activeServices.length,
    monthlyTransactions: stats.monthCount,
    monthlyCollections: stats.monthCollected,
    receipts: stats.totalReceipts,
  }

  // Calendar dots: one month at a time, only for the month the calendar is showing.
  const calendarMonthKey = `${calendarCursor.year}-${String(calendarCursor.month + 1).padStart(2, '0')}`

  useEffect(() => { loadedMonthsRef.current = new Set(); setActivityByMonth({}) }, [reloadTick])

  useEffect(() => {
    if (!calendar.open || loadedMonthsRef.current.has(calendarMonthKey)) return undefined
    loadedMonthsRef.current.add(calendarMonthKey)
    let cancelled = false
    const range = monthRangeOf(calendarMonthKey)

    supabase
      .from('service_transactions')
      .select('service_date')
      .gte('service_date', range.dateFrom)
      .lt('service_date', range.dateTo)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { loadedMonthsRef.current.delete(calendarMonthKey); return }
        setActivityByMonth((current) => ({
          ...current,
          [calendarMonthKey]: new Set((data || []).map((row) => row.service_date)),
        }))
      })

    return () => { cancelled = true }
  }, [calendar.open, calendarMonthKey, reloadTick])

  const activityDates = useMemo(() => {
    const set = new Set()
    Object.values(activityByMonth).forEach((days) => days.forEach((day) => set.add(day)))
    return set
  }, [activityByMonth])

  // Receipts for the day picked in the calendar - fetched when the day modal opens.
  useEffect(() => {
    if (!dayModalDate) { setDayRows([]); return undefined }
    let cancelled = false
    setDayLoading(true)

    supabase
      .from('service_transactions')
      .select('*')
      .eq('service_date', dayModalDate)
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('paid_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        setDayRows(error ? [] : data || [])
        if (error) setPageError(`Could not load that day's receipts: ${error.message}`)
        setDayLoading(false)
      })

    return () => { cancelled = true }
  }, [dayModalDate, reloadTick])

  const dayModalTransactions = dayRows

  const dayModalTotal = useMemo(
    () => toCents(dayModalTransactions.reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0)),
    [dayModalTransactions],
  )

  const monthGrid = useMemo(
    () => buildMonthGrid(calendarCursor.year, calendarCursor.month),
    [calendarCursor],
  )

  function openCalendar() {
    const [year, month] = today().split('-').map(Number)
    setCalendarCursor({ year, month: month - 1 })
    calendar.toggle()
  }

  function changeCalendarMonth(delta) {
    setCalendarCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1))
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() }
    })
  }

  function pickDay(dateKey) {
    calendar.hide()
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
  const amountDue = toCents(
    (Number(selectedService?.rate) || 0) *
    Math.max(Number(transactionForm.quantity) || 1, 1),
  )

  // Whatever is handed over above the amount due is change, never revenue or credit.
  const amountReceived = toCents(transactionForm.amount_paid) || 0
  const amountApplied = Math.min(amountReceived, amountDue)
  const changeDue = toCents(Math.max(amountReceived - amountDue, 0))
  const stillOwed = toCents(Math.max(amountDue - amountReceived, 0))

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
      amount_paid: service?.rate
        ? String(toCents((Number(service.rate) || 0) * Math.max(Number(current.quantity) || 1, 1)))
        : '',
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

    const received = toCents(transactionForm.amount_paid)

    if (!Number.isFinite(received) || received <= 0) {
      setPageError('Enter the amount received, greater than zero.')
      return
    }

    // Only the amount due is kept; anything extra is change handed back.
    const paid = Math.min(received, amountDue)
    const change = toCents(Math.max(received - amountDue, 0))
    const changeNote = change > 0
      ? `Received ${peso.format(received)}; ${peso.format(change)} returned as change.`
      : ''
    const notes = [transactionForm.notes.trim(), changeNote].filter(Boolean).join(' ') || null

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
      notes,
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

    setTransactionForm(emptyTransaction)
    setShowPaymentForm(false)
    setReceipt(data)
    setSaving(false)
    setReloadTick((tick) => tick + 1)

    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: 'Service Payment Recorded',
      target: `${data.receipt_number} — ${data.service_name} for ${data.customer_name}`,
    })

    if (activityError) {
      console.warn('Service saved, but activity logging failed:', activityError.message)
    }
  }

  // --- Collecting the unpaid balance of a partial payment (creates a new, linked receipt) ---
  function openCollect(balanceRow) {
    if (!canManageServices) return
    setCollectTarget(balanceRow)
    setCollectForm({ ...emptyCollect, amount: String(toCents(balanceRow.balance_due)) })
    setCollectError('')
  }

  async function collectBalance(event) {
    event.preventDefault()
    if (!collectTarget || !canManageServices || !currentUser?.id) return

    const amount = toCents(collectForm.amount)
    const remaining = toCents(collectTarget.balance_due)

    if (!Number.isFinite(amount) || amount <= 0) {
      setCollectError('Enter an amount greater than zero.')
      return
    }
    if (amount > remaining) {
      setCollectError(`The most that can be collected is ${peso.format(remaining)}. Extra money is change.`)
      return
    }
    if (collectForm.payment_method !== 'Cash' && !collectForm.reference_number.trim()) {
      setCollectError('A reference number is required for non-cash payments.')
      return
    }

    setSaving(true)
    setCollectError('')

    // The database fills in the customer, service and receipt details from the original
    // receipt and rejects anything above the unpaid balance.
    const { data, error } = await supabase
      .from('service_transactions')
      .insert({
        balance_of: collectTarget.id,
        property_id: collectTarget.property_id,
        service_id: collectTarget.service_id,
        service_name: collectTarget.service_name,
        customer_name: collectTarget.customer_name,
        block_name: collectTarget.block_name,
        lot_number: collectTarget.lot_number,
        service_date: today(),
        quantity: 1,
        amount_due: amount,
        amount_paid: amount,
        payment_status: 'paid',
        payment_method: collectForm.payment_method,
        reference_number: collectForm.reference_number.trim() || null,
        notes: collectForm.notes.trim() || null,
        recorded_by: currentUser.id,
        recorded_by_name: recorderName,
      })
      .select('*')
      .single()

    setSaving(false)

    if (error) {
      setCollectError(error.message)
      return
    }

    setCollectTarget(null)
    setReceipt(data)
    setReloadTick((tick) => tick + 1)

    await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: 'Service Balance Collected',
      target: `${data.receipt_number} — ${peso.format(amount)} for ${collectTarget.receipt_number} — ${collectTarget.customer_name}`,
    })
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
                  aria-expanded={calendar.open}
                >
                  <CalendarIcon size={17} /> View by Date
                </button>

                {calendar.mounted && (
                  <div className={`services-calendar-animation ${calendar.visible ? 'is-visible' : ''}`}>
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

      {balances.length > 0 && (
        <section className="service-catalog svc-balances">
          <div className="services-section-heading">
            <div>
              <h2>Unpaid service balances</h2>
              <p>
                {balances.length} partial payment{balances.length === 1 ? '' : 's'} with{' '}
                <strong>{peso.format(totalUnpaid)}</strong> still to collect. Collecting a balance issues a new receipt.
              </p>
            </div>
          </div>
          <div className="svc-balance-list">
            {balances.map((row) => (
              <div className="svc-balance-row" key={row.id}>
                <div className="svc-balance-main">
                  <strong>{row.customer_name}</strong>
                  <span>{row.block_name}, Lot {row.lot_number} · {row.service_name}</span>
                  <small>
                    {row.receipt_number} · due {peso.format(Number(row.amount_due) || 0)}, paid{' '}
                    {peso.format((Number(row.amount_paid) || 0) + (Number(row.collected_later) || 0))}
                  </small>
                </div>
                <strong className="svc-balance-amount">{peso.format(Number(row.balance_due) || 0)}</strong>
                {canManageServices && (
                  <button type="button" className="svc-balance-button" onClick={() => openCollect(row)}>
                    Collect balance
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

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
                  onWheel={(event) => event.currentTarget.blur()}
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
              <HomeownerCombobox
                properties={properties}
                value={transactionForm.property_id}
                onChange={(propertyId) =>
                  setTransactionForm((current) => ({
                    ...current,
                    property_id: propertyId,
                  }))
                }
              />
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
              <label className="services-time-field">
                Start time
                <input
                  aria-label="Start time"
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
                  onChange={(event) => {
                    const nextQuantity = event.target.value
                    setTransactionForm((current) => {
                      // Keep "amount received" in step with the amount due while the two still match.
                      const rate = Number(selectedService?.rate) || 0
                      const oldDue = toCents(rate * Math.max(Number(current.quantity) || 1, 1))
                      const newDue = toCents(rate * Math.max(Number(nextQuantity) || 1, 1))
                      const followsDue = toCents(current.amount_paid) === oldDue
                      return {
                        ...current,
                        quantity: nextQuantity,
                        amount_paid: followsDue ? String(newDue) : current.amount_paid,
                      }
                    })
                  }}
                />
              </label>
            </div>

            <div className="services-amount-due">
              <span>Amount due</span>
              <strong>{peso.format(amountDue)}</strong>
            </div>

            <div className="services-form-row">
              <label>
                Amount received
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={transactionForm.amount_paid}
                  onWheel={(event) => event.currentTarget.blur()}
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

            {amountReceived > 0 && amountDue > 0 && (
              <div className="services-amount-due">
                {changeDue > 0 ? (
                  <><span>Change to return</span><strong>{peso.format(changeDue)}</strong></>
                ) : stillOwed > 0 ? (
                  <><span>Partial payment — still unpaid</span><strong>{peso.format(stillOwed)}</strong></>
                ) : (
                  <><span>Paid in full</span><strong>{peso.format(amountApplied)}</strong></>
                )}
              </div>
            )}

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

      {collectTarget && (
        <div className="services-modal-backdrop" role="presentation">
          <form className="services-modal" onSubmit={collectBalance}>
            <div className="services-modal-header">
              <div>
                <h2>Collect Unpaid Balance</h2>
                <p>
                  {collectTarget.customer_name} — {collectTarget.service_name} ({collectTarget.receipt_number})
                </p>
              </div>
              <button type="button" onClick={() => !saving && setCollectTarget(null)} aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <div className="services-amount-due">
              <span>Unpaid balance</span>
              <strong>{peso.format(Number(collectTarget.balance_due) || 0)}</strong>
            </div>

            <div className="services-form-row">
              <label>
                Amount collected
                <input
                  required
                  min="0.01"
                  step="0.01"
                  type="number"
                  value={collectForm.amount}
                  onWheel={(event) => event.currentTarget.blur()}
                  onChange={(event) => { setCollectForm((current) => ({ ...current, amount: event.target.value })); setCollectError('') }}
                />
              </label>
              <label>
                Payment method
                <select
                  value={collectForm.payment_method}
                  onChange={(event) => setCollectForm((current) => ({ ...current, payment_method: event.target.value }))}
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
                value={collectForm.reference_number}
                onChange={(event) => setCollectForm((current) => ({ ...current, reference_number: event.target.value }))}
                placeholder="Required for non-cash payments"
              />
            </label>
            <label>
              Notes
              <textarea
                rows="2"
                value={collectForm.notes}
                onChange={(event) => setCollectForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </label>

            {collectError && <p className="services-error">{collectError}</p>}

            <div className="services-modal-actions">
              <button type="button" onClick={() => setCollectTarget(null)} disabled={saving}>Cancel</button>
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Collect & Issue Receipt'}</button>
            </div>
          </form>
        </div>
      )}

      {receipt && (
        <div className="services-modal-backdrop" role="presentation">
          <article className="service-receipt receipt-card">
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
              {receipt.notes && <div><dt>Notes</dt><dd>{receipt.notes}</dd></div>}
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
                <strong>{dayLoading ? '…' : dayModalTransactions.length}</strong>
              </div>
              <div>
                <span>Amount collected</span>
                <strong>{dayLoading ? '…' : peso.format(dayModalTotal)}</strong>
              </div>
            </div>

            <div className="day-modal-list">
              {dayLoading && dayModalTransactions.length === 0 ? (
                <p className="services-day-empty">Loading...</p>
              ) : dayModalTransactions.length === 0 ? (
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
                      {balanceById.get(item.id) && (
                        <span>Unpaid {peso.format(Number(balanceById.get(item.id).balance_due) || 0)}</span>
                      )}
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