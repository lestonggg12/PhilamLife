import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import DateField from '../components/DateField'
import Select from '../components/Select'
import {
  CheckCircle,
  CreditCard,
  Eye,
  FileText,
  Plus,
  RefreshCw,
  X,
} from '../components/Icons'
import Skeleton from '../components/skeleton/Skeleton'

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
import { useSettledAmount } from '../lib/useSettledAmount'
import { fetchAll } from '../lib/fetchAll'
import { verifiedServiceStats } from '../lib/serviceStats'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'
import ServiceVoidDialog from '../components/ServiceVoidDialog'
import { ReceiptDialog } from '../components/ReceiptSheet'
import { buildReceiptModel } from '../lib/receiptModel'
import { printReceipt } from '../lib/printReceipt'
import './ServicesManagementPage.css'
import useAnimatedPopover from '../hooks/useAnimatedPopover'
import TimePicker, { formatTime12, rangesOverlap, timeToMinutes } from '../components/TimePicker'

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
  end_time: '',
  quantity: '1',
  amount_paid: '',
  payment_method: 'Cash',
  reference_number: '',
  notes: '',
}

const emptyCollect = { amount: '', payment_method: 'Cash', reference_number: '', notes: '' }
// Edit this one line if hourly services are identified differently.
const isHourlyService = (service) => service?.rate_unit === 'per hour'
const TIME_MINUTE_STEP = 5

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
  const [bookingConfirmation, setBookingConfirmation] = useState(null)
  const bookingConfirmationResolver = useRef(null)
  const [pageError, setPageError] = useState('')
  const [showServiceForm, setShowServiceForm] = useState(false)
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [editingServiceId, setEditingServiceId] = useState(null)
  const [serviceForm, setServiceForm] = useState(emptyService)
  const [transactionForm, setTransactionForm] = useState(emptyTransaction)
  const [receipt, setReceipt] = useState(null)
  const settledAmount = useSettledAmount(receipt)

  // Totals for the current month and overall come from small database queries;
  // the page never downloads the full list of service receipts.
  const [stats, setStats] = useState({ monthCount: 0, monthCollected: 0, totalReceipts: 0 })
  const [balances, setBalances] = useState([])
  const [statsError, setStatsError] = useState('')
  const [collectTarget, setCollectTarget] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [collectForm, setCollectForm] = useState(emptyCollect)
  const [collectError, setCollectError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
    const [bookedRanges, setBookedRanges] = useState([])
  const [bookedLoading, setBookedLoading] = useState(false)
  const [bookedError, setBookedError] = useState('')

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
  const canManageServices = currentUser?.is_active !== false && role === 'secretary'
  const canRecordServicePayments = currentUser?.is_active !== false && (role === 'secretary' || role === 'treasurer')
  useEffect(() => {
    return () => {
      if (bookingConfirmationResolver.current) {
        bookingConfirmationResolver.current(false)
        bookingConfirmationResolver.current = null
      }
    }
  }, [])
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

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

  useEffect(() => {
    setBookedRanges([])
    setBookedError('')
    if (!showPaymentForm || !transactionForm.service_id || !transactionForm.service_date) {
      setBookedLoading(false)
      return undefined
    }


    let cancelled = false
    setBookedLoading(true)

    supabase
      .from('service_transactions')
      .select('start_time, end_time')
      .eq('service_id', transactionForm.service_id)
      .eq('service_date', transactionForm.service_date)
      .not('start_time', 'is', null)
      .not('end_time', 'is', null)
            .neq('payment_status', 'voided')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          setBookedError('Could not check booked times. Availability is unverified.')
          setBookedLoading(false)
          return
        }
        const ranges = (data || [])
          .map((row) => ({ start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5) }))
          .filter((range) => range.end > range.start)
          .sort((a, b) => a.start.localeCompare(b.start))
        setBookedRanges(ranges)
        setBookedLoading(false)


      })

    return () => { cancelled = true }
  }, [showPaymentForm, transactionForm.service_id, transactionForm.service_date, services, reloadTick])

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
    try {
      const [serviceResult, propertyResult] = await Promise.all([
        supabase.from('amenity_services').select('*').order('name'),
        fetchAll(() => supabase
          .from('properties')
          .select('id, homeowner_name, block, lot_number, homeowner_status')
          .order('homeowner_name')),
      ])
      if (serviceResult.error) throw serviceResult.error
      if (propertyResult.error) throw propertyResult.error
      if (!Array.isArray(serviceResult.data) || !Array.isArray(propertyResult.data)) {
        throw new Error('The service catalog or homeowner list is incomplete.')
      }
      setServices(serviceResult.data)
      setProperties(propertyResult.data)
      setReloadTick((tick) => tick + 1)
    } catch (error) {
      setPageError(`Service records could not be loaded: ${error?.message || 'Connection failed.'}`)
    } finally {
      setLoading(false)
    }
  }

  // This month's totals, the all-time receipt count and the unpaid balances.
  useEffect(() => {
    let cancelled = false
    setStatsError('')

    async function loadStats() {
      try {
        const range = monthRangeOf(today().slice(0, 7))
        const [summaryResult, countResult, balanceResult] = await Promise.all([
          supabase.rpc('receipts_period_summary', { p_from: range.from, p_to: range.to }),
          supabase.from('service_transactions').select('id', { count: 'exact', head: true }),
          fetchAll(() => supabase.from('service_balances').select('*')
            .order('paid_at', { ascending: true }).order('id'), { tiebreaker: null }),
        ])
        const verified = verifiedServiceStats(summaryResult, countResult, balanceResult)
        if (cancelled) return
        setStats(verified.stats)
        setBalances(verified.balances)
      } catch (error) {
        if (!cancelled) setStatsError(`Service totals and unpaid balances are unavailable: ${error?.message || 'Connection failed.'}`)
      }
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
    () => toCents(dayModalTransactions
      .filter((item) => String(item.payment_status || '').toLowerCase() !== 'voided')
      .reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0)),
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

  const startMinutes = timeToMinutes(transactionForm.start_time)
  const endMinutes = timeToMinutes(transactionForm.end_time)
  const autoHours =
    isHourlyService(selectedService) &&
    startMinutes !== null &&
    endMinutes !== null &&
    endMinutes > startMinutes
      ? Math.round(((endMinutes - startMinutes) / 60) * 100) / 100
      : null

  useEffect(() => {
    if (autoHours === null) return
    setTransactionForm((current) => {
      if (Number(current.quantity) === autoHours) return current
      // Same "amount received follows amount due" rule the Quantity field already uses.
      const rate = Number(selectedService?.rate) || 0
      const oldDue = toCents(rate * Math.max(Number(current.quantity) || 1, 1))
      const newDue = toCents(rate * Math.max(autoHours, 1))
      const followsDue = toCents(current.amount_paid) === oldDue
      return {
        ...current,
        quantity: String(autoHours),
        amount_paid: followsDue ? String(newDue) : current.amount_paid,
      }
    })
  }, [autoHours, selectedService?.id])

  const amountDue = toCents(
    (Number(selectedService?.rate) || 0) *
    Math.max(Number(transactionForm.quantity) || 1, 1),
  )

  // Whatever is handed over above the amount due is change, never revenue or credit.
  const amountReceived = toCents(transactionForm.amount_paid) || 0
  const amountApplied = Math.min(amountReceived, amountDue)
  const changeDue = toCents(Math.max(amountReceived - amountDue, 0))
  const stillOwed = toCents(Math.max(amountDue - amountReceived, 0))
    const hourlySlotRequired =
      Boolean(selectedService)

    const endTimeError = hourlySlotRequired && !transactionForm.start_time
      ? 'Select a start and end time for the reservation.'
      : transactionForm.start_time
    ? !transactionForm.end_time
      ? 'Enter an end time.'
      : transactionForm.end_time <= transactionForm.start_time
        ? 'End time must be later than start time.'
        : ''
    : ''

  function openPaymentForm(service = null) {
    if (!canRecordServicePayments) return

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

  function handleServiceChange(serviceId) {
    const service = services.find(
      (item) => String(item.id) === String(serviceId)
    )
    setTransactionForm((current) => ({
      ...current,
      service_id: serviceId,
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

    try {
      const { data, error } = await query.select('*').single()
      if (error) throw error
      if (!data?.id || (editingServiceId && data.id !== editingServiceId)) {
        throw new Error('Service save could not be confirmed. Refresh before retrying.')
      }
      setServices((current) => {
        const updated = editingServiceId
          ? current.map((item) => (item.id === data.id ? data : item))
          : [...current, data]
        return updated.sort((left, right) => left.name.localeCompare(right.name))
      })
      notifySuccess(`${data.name} was ${editingServiceId ? 'updated' : 'added'}.`)
      setServiceForm(emptyService)
      setEditingServiceId(null)
      setShowServiceForm(false)
    } catch (error) {
      setPageError(`Service save could not be confirmed. ${error?.message || 'Connection failed.'}`)
    } finally {
      setSaving(false)
    }


  }

  function finishBookingConfirmation(accepted) {
    const resolve = bookingConfirmationResolver.current
    bookingConfirmationResolver.current = null
    setBookingConfirmation(null)
    if (resolve) resolve(accepted)
  }

  async function saveTransaction(event) {
    event.preventDefault()
    if (!canRecordServicePayments || !currentUser?.id) {
      setPageError('Only an active Secretary or Treasurer can record service payments.')
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

        if (endTimeError) {
      setPageError(endTimeError)
      return
    }

    // Never accept a timed reservation while availability is unverified.
    if (bookedLoading || bookedError) {
      setPageError(
        'Booking availability could not be verified. Refresh before recording this service.',
      )
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
      end_time: transactionForm.end_time || null,
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

    try {
      const { count, error: availabilityError } = await supabase
        .from('service_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('service_id', payload.service_id)
        .eq('service_date', payload.service_date)
        .is('balance_of', null)
        .neq('payment_status', 'voided')
        .lt('start_time', payload.end_time)
        .gt('end_time', payload.start_time)

      if (availabilityError || !Number.isInteger(count)) {
        throw new Error('Booking availability cannot be verified. No payment was recorded.')
      }

      if (count > 0) {
        const accepted = await new Promise((resolve) => {
          bookingConfirmationResolver.current = resolve
          setBookingConfirmation({
            serviceName: service.name,
            count,
          })
        })
        if (!accepted) return
      }

      const reviewedPayload = { ...payload, overlap_acknowledged_count: count }
      const { data, error } = await supabase
        .from('service_transactions')
        .insert(reviewedPayload)
        .select('*')
        .single()
      if (error) throw error
      if (!data?.id || data.property_id !== Number(property.id) || !data.receipt_number) {
        throw new Error('The receipt could not be confirmed. Refresh history before retrying to avoid a duplicate.')
      }
      setTransactionForm(emptyTransaction)
      setShowPaymentForm(false)
      setReceipt(data)
      notifySuccess(`Service payment ${data.receipt_number} recorded for ${data.customer_name}.`)
      setReloadTick((tick) => tick + 1)
    } catch (error) {
      if (error?.code === '40001') {
        setPageError('Reservations changed during confirmation. Review the latest occupancy and try again.')
        setReloadTick((tick) => tick + 1)

      } else {
        setPageError(`Service payment could not be confirmed. Check receipt history before retrying. ${error?.message || 'Connection failed.'}`)
      }
    } finally {
      setSaving(false)
    }


  }

  // --- Collecting the unpaid balance of a partial payment (creates a new, linked receipt) ---
  function openCollect(balanceRow) {
    if (!canRecordServicePayments) return
    setCollectTarget(balanceRow)
    setCollectForm({ ...emptyCollect, amount: String(toCents(balanceRow.balance_due)) })
    setCollectError('')
  }

  async function collectBalance(event) {
    event.preventDefault()
    if (!collectTarget || !canRecordServicePayments || !currentUser?.id) return

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

    try {
      if (error) throw error
      if (!data?.id || String(data.balance_of) !== String(collectTarget.id) || !data.receipt_number) {
        throw new Error('The collection receipt could not be verified.')
      }
      setCollectTarget(null)
      setReceipt(data)
      notifySuccess(`${peso.format(amount)} collected for ${data.customer_name}. Receipt ${data.receipt_number} was created.`)
      setReloadTick((tick) => tick + 1)
    } catch (error) {
      setCollectError(`Collection could not be confirmed. Check receipts before retrying. ${error?.message || 'Connection failed.'}`)
    } finally {
      setSaving(false)
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
          {canRecordServicePayments && (
            <>
              {canManageServices && (
              <button
                type="button"
                className="services-button services-button-secondary"
                onClick={() => openServiceForm()}
              >
                <Plus size={17} /> Add Service
              </button>
              )}

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
          {canRecordServicePayments
            ? 'You may record service payments and collect unpaid balances. Service catalog editing remains Secretary-only.'
            : 'Service payments may be recorded only by an active Secretary or Treasurer.'}
        </p>
      )}

      <section className="services-summary" aria-label="Service summaries">
        <article>
          <span>Active Services</span>
          <strong>{loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : summary.activeServices}</strong>
          <small>Available village amenities</small>
        </article>
        <article>
          <span>Transactions This Month</span>
          <strong>{loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : statsError ? 'Unavailable' : summary.monthlyTransactions}</strong>
          <small>Service payments recorded</small>
        </article>
        <article>
          <span>Collections This Month</span>
          <strong>{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : statsError ? 'Unavailable' : peso.format(summary.monthlyCollections)}</strong>
          <small>Based on Manila time</small>
        </article>
        <article>
          <span>Receipts Issued</span>
          <strong>{loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : statsError ? 'Unavailable' : summary.receipts}</strong>
          <small>Permanent service records</small>
        </article>
      </section>

      {statsError && <p role="alert" className="services-error">{statsError}</p>}
      {!statsError && balances.length > 0 && (
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
                {canRecordServicePayments && (
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
          <div className="services-state" aria-busy="true"><Skeleton variant="rect" width="100%" height="100px" /><Skeleton variant="rect" width="100%" height="100px" /><Skeleton variant="rect" width="100%" height="100px" /><span className="skeleton-region-status" role="status">Loading</span></div>
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
                {canRecordServicePayments && (
                  <div className="service-card-actions">
                    {canManageServices && (
                      <button type="button" onClick={() => openServiceForm(service)}>
                        Edit
                      </button>
                    )}
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
                <Select ariaLabel="Rate unit" value={serviceForm.rate_unit} onChange={(value) => setServiceForm((current) => ({ ...current, rate_unit: value }))} options={['per use', 'per hour', 'per person', 'per day'].map((value) => ({ value, label: value }))} />
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
                <Select ariaLabel="Service" value={transactionForm.service_id} onChange={handleServiceChange} placeholder="Select service" options={activeServices.map((service) => ({ value: String(service.id), label: service.name }))} />
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

            <div className="services-form-row services-form-row-four">
              <label>
                Service date
                <DateField ariaLabel="Service date" name="service_date" value={transactionForm.service_date} onChange={(value) => setTransactionForm((current) => ({ ...current, service_date: value }))} required />
              </label>
                            <TimePicker
                label="Start time"
                mode="start"
                value={transactionForm.start_time}
                counterpart={transactionForm.end_time}
                bookedRanges={[]}
                loading={bookedLoading}
                minuteStep={TIME_MINUTE_STEP}
                onChange={(next) =>
                  setTransactionForm((current) => ({ ...current, start_time: next }))
                }
              />
              <TimePicker
                label="End time"
                mode="end"
                value={transactionForm.end_time}
                counterpart={transactionForm.start_time}
                bookedRanges={[]}
                loading={bookedLoading}
                minuteStep={TIME_MINUTE_STEP}
                invalid={Boolean(endTimeError)}
                onChange={(next) =>
                  setTransactionForm((current) => ({ ...current, end_time: next }))
                }
              />
                            
              <label>
                Quantity
                <input
                  required
                                    min={autoHours !== null ? '0.01' : '1'}
                                    step="any"
                  readOnly={autoHours !== null}
                  title={autoHours !== null ? 'Calculated from start and end time' : undefined}
                  className={autoHours !== null ? 'services-input-auto' : undefined}
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

                        {endTimeError && (
              <p className="services-field-error" role="alert">{endTimeError}</p>
            )}
                        {bookedLoading && (
              <span className="services-booked-note" role="status"><Skeleton variant="rect" width="140px" height="1em" /></span>
            )}
            {bookedError && (
              <p className="services-field-error" role="alert">{bookedError}</p>
            )}
            {!bookedLoading && bookedRanges.length > 0 && (
              <p className="services-booked-note">
                Existing reservations:{' '}
                {bookedRanges
                  .map((r) => `${formatTime12(r.start, false)} - ${formatTime12(r.end, false)}`)
                  .join(', ')}
              </p>
            )}

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
                <Select ariaLabel="Payment method" value={transactionForm.payment_method} onChange={(value) => setTransactionForm((current) => ({ ...current, payment_method: value }))} options={['Cash', 'GCash', 'Bank Transfer', 'Check'].map((value) => ({ value, label: value }))} />
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
              <button type="submit" disabled={saving || bookedLoading || Boolean(bookedError) || amountDue <= 0 || !(Number(transactionForm.amount_paid) > 0) || Boolean(endTimeError)}>
                {saving ? 'Saving...' : 'Save & Issue Receipt'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ActionDialog
        open={Boolean(bookingConfirmation)}
        title="Overlapping Reservation"
        message={
          bookingConfirmation
            ? `${bookingConfirmation.count} existing reservation(s) overlap your selected time for ${bookingConfirmation.serviceName}.\n\nDo you want to continue and record this payment?`
            : ''
        }
        confirmLabel="Continue & Record Payment"
        cancelLabel="Cancel"
        onConfirm={() => finishBookingConfirmation(true)}
        onCancel={() => finishBookingConfirmation(false)}
      />
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
                <Select ariaLabel="Payment method" value={collectForm.payment_method} onChange={(value) => setCollectForm((current) => ({ ...current, payment_method: value }))} options={['Cash', 'GCash', 'Bank Transfer', 'Check'].map((value) => ({ value, label: value }))} />
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
              <button type="button" className="button-cancel" onClick={() => setCollectTarget(null)} disabled={saving}>Cancel</button>
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Collect & Issue Receipt'}</button>
            </div>
          </form>
        </div>
      )}

      {receipt && (() => {
        const receiptModel = buildReceiptModel('service', receipt, organization, { settledAmount })
        return (
          <ReceiptDialog
            model={receiptModel}
            dismissOnBackdrop={false}
            onClose={() => setReceipt(null)}
            onPrint={(setup) => printReceipt(receiptModel, setPopupNotice, setup)}
          />
        )
      })()}

      {voidTarget && (
        <ServiceVoidDialog
          receipt={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={(updated) => {
            setDayRows((rows) =>
              rows.map((row) => row.id === updated.id ? updated : row)
            )
            setVoidTarget(null)
            setReloadTick((tick) => tick + 1)
          }}
        />
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
                <div className="services-day-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="48px" /><Skeleton variant="rect" width="100%" height="48px" /><Skeleton variant="rect" width="100%" height="48px" /><span className="skeleton-region-status" role="status">Loading</span></div>
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
                      {item.start_time && (
                    <span>
                      {formatTime12(item.start_time, false)}
                      {item.end_time ? ` - ${formatTime12(item.end_time, false)}` : ''}
                    </span>
                  )}
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
                      {canRecordServicePayments && item.payment_status !== 'voided' && (
                        <button
                          type="button"
                          className="svd-inline-button"
                          onClick={() => setVoidTarget(item)}
                        >
                          Void Receipt
                        </button>
                      )}
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