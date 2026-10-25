import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { advanceCreditDetails, advanceCreditNote } from '../lib/advanceCredit'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'
import BalanceBreakdown from '../components/BalanceBreakdown'
import { ReceiptDialog } from '../components/ReceiptSheet'
import { buildReceiptModel } from '../lib/receiptModel'
import { printReceipt } from '../lib/printReceipt'
import './PaymentsPage.css'
import useAnimatedPopover from '../hooks/useAnimatedPopover'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { Pager } from '../components/PagerControls'
import {
  applySearch,
  applyTimeRange,
  countLabel,
  dayRange,
  ilikeAny,
  interpretPage,
  pageCount,
  pageWindow,
  searchTokens,
} from '../lib/pagedQuery'

// Columns the payment-history search looks through (every word must match one of them).
const PAYMENT_SEARCH_COLUMNS = [
  'receipt_number',
  'homeowner_name',
  'block_name',
  'lot_number',
  'coverage_period',
  'payment_method',
  'reference_number',
  'status',
]

const PAYMENT_PURPOSES = [
  'Association Dues',
  'Special Assessment',
  'Penalty / Late Fee',
  'Sticker / ID Fee',
  'Document / Certification Fee',
  'Other',
]

// Association Dues are billed automatically every month, so they can't be added by hand.
const CHARGE_TYPES = PAYMENT_PURPOSES.filter((purpose) => purpose !== 'Association Dues')

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

const formatBalance = (value) =>
  value < 0 ? `Advance credit ${peso.format(Math.abs(value))}` : peso.format(value)

const EMPTY_CHARGE = {
  propertyId: '',
  chargeType: 'Penalty / Late Fee',
  description: '',
  amount: '',
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
// Date on" - the calendar's "today" reads through here.
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

function manilaToday() {
  return manilaDateParts(new Date())
}

function todayDateKey() {
  const { year, month, day } = manilaToday()
  return dateKeyOf(year, month, day)
}

function shiftDateKey(key, delta) {
  const [year, month, day] = key.split('-').map(Number)
  const date = new Date(year, month - 1, day + delta)
  return dateKeyOf(date.getFullYear(), date.getMonth(), date.getDate())
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
  onViewMonthChange,
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

  // Tell the page which month is showing so it can fetch just that month's dots.
  useEffect(() => {
    if (onViewMonthChange) onViewMonthChange(viewYear, viewMonth)
  }, [viewYear, viewMonth])

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

  const atCurrentMonth =
    viewYear > manilaAnchor.year ||
    (viewYear === manilaAnchor.year && viewMonth >= manilaAnchor.month)
  const onTodayAlready = selectedDateKey === todayKey && atCurrentMonth

  const chevron = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  )

  return (
    <div
      className="payments-calendar-popover"
      role="dialog"
      aria-label="Choose a payment date"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="payments-calendar-nav">
        <button
          type="button"
          className="payments-calendar-nav-button previous"
          onClick={goToPrevMonth}
          aria-label="Previous month"
        >
          {chevron}
        </button>

        <strong className="payments-calendar-title">
          {CALENDAR_MONTH_LABEL.format(new Date(viewYear, viewMonth, 1))}
        </strong>

        <button
          type="button"
          className="payments-calendar-nav-button"
          onClick={goToNextMonth}
          disabled={atCurrentMonth}
          aria-label="Next month"
        >
          {chevron}
        </button>
      </div>

      <div className="payments-calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="payments-calendar-grid">
        {weeks.flat().map((cell) => {
          const isSelected = cell.dateKey === selectedDateKey
          const isToday = cell.dateKey === todayKey
          const isFuture = cell.dateKey > todayKey
          const hasPayments = activeDateKeys.has(cell.dateKey)

          const classNames = [
            'payments-calendar-day',
            cell.outside ? 'payments-calendar-day-outside' : '',
            isFuture ? 'payments-calendar-day-future' : '',
            isToday ? 'payments-calendar-day-today' : '',
            isSelected ? 'payments-calendar-day-selected' : '',
            hasPayments && !cell.outside ? 'payments-calendar-day-dot' : '',
          ]
            .filter(Boolean)
            .join(' ')

          return (
            <button
              type="button"
              key={cell.dateKey}
              className={classNames}
              disabled={isFuture}
              aria-pressed={isSelected}
              onClick={() => onSelectDate(cell.dateKey)}
            >
              {cell.day}
            </button>
          )
        })}
      </div>

      <div className="payments-calendar-legend-row">
        <div className="payments-calendar-legend">
          <span><i className="payments-calendar-key-today" /> Today</span>
          <span><i className="payments-calendar-key-dot" /> Has payments</span>
        </div>
        <button
          type="button"
          className="payments-calendar-today-link"
          onClick={jumpToToday}
          disabled={onTodayAlready}
        >
          Jump to today
        </button>
      </div>
    </div>
  )
}

export default function PaymentsPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  // One page (50) of payments at a time, read from the database.
  const [rows, setRows] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, minimum: 0 })
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [summary, setSummary] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [activeDays, setActiveDays] = useState({})
  const [openOfType, setOpenOfType] = useState(0)
  const [properties, setProperties] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [popupNotice, setPopupNotice] = useState('')
  const [duesSettings, setDuesSettings] = useState(null)
  const [advanceConfirm, setAdvanceConfirm] = useState(null)
  const [annualAdvance, setAnnualAdvance] = useState(false)
  const [monthlyDuesByProperty, setMonthlyDuesByProperty] = useState(new Map())
  // Advance-credit notes use the selected homeowner's own monthly dues (lot size x rate).
  const duesSettingsFor = (propertyId) => (duesSettings
    ? { ...duesSettings, monthly_dues: monthlyDuesByProperty.get(Number(propertyId)) || 0 }
    : null)
  const [chargeRows, setChargeRows] = useState([])
  const [chargeTotal, setChargeTotal] = useState(0)
  const [chargesLoading, setChargesLoading] = useState(false)
  const [showCharges, setShowCharges] = useState(false)
  const [chargeSearch, setChargeSearch] = useState('')
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState('')
  const advanceApprovedRef = useRef(false)
  const [showCharge, setShowCharge] = useState(false)
  const [chargeForm, setChargeForm] = useState(EMPTY_CHARGE)
  const [chargeError, setChargeError] = useState('')
  const [chargeSaving, setChargeSaving] = useState(false)
  // Type-to-search homeowner field in the Add Charge dialog.
  const [chargeHomeownerText, setChargeHomeownerText] = useState('')
  const [chargeMenuOpen, setChargeMenuOpen] = useState(false)
  const [homeownerMenuOpen, setHomeownerMenuOpen] = useState(false)
  const [selectedDateKey, setSelectedDateKey] = useState(() => todayDateKey())
  const calendar = useAnimatedPopover()
  const calendarAnchorRef = useRef(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManagePayments =
    role === 'admin' || role === 'secretary' || role === 'treasurer'
  // Adding or voiding a charge changes a homeowner's balance directly, so treasurers are excluded.
  const canManageCharges = role === 'admin' || role === 'secretary'
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

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        calendar.hide()
      }
    }

    function handleOutsideClick(event) {
      if (
        calendarAnchorRef.current &&
        !calendarAnchorRef.current.contains(event.target)
      ) {
        calendar.hide()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleOutsideClick)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [calendar.open])

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

    const [propertyResult, settingsResult, billedResult, duesResult] = await Promise.all([
      fetchAll(() => supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number, homeowner_status, current_balance')
        .order('homeowner_name')),
      supabase
        .from('system_settings')
        .select('billing_day, due_day, grace_period_days')
        .eq('id', 1)
        .maybeSingle(),
      // Has this month's dues run already? (decides which billing date the advance note shows)
      supabase
        .from('property_charges')
        .select('id')
        .eq('billing_month', `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 7)}-01`)
        .limit(1),
      fetchAll(() => supabase
        .from('property_monthly_dues')
        .select('property_id, monthly_dues')
        .order('property_id'), { tiebreaker: null }),
    ])

    if (!settingsResult.error && settingsResult.data) {
      setDuesSettings({
        ...settingsResult.data,
        billed_this_month: !billedResult.error && (billedResult.data || []).length > 0,
      })
    }

    if (!duesResult.error) {
      setMonthlyDuesByProperty(new Map((duesResult.data || []).map((row) => [Number(row.property_id), row.monthly_dues])))
    }

    if (propertyResult.error) {
      setPageError(`Could not load ledger homeowners: ${propertyResult.error.message}`)
    } else {
      setProperties(propertyResult.data || [])
    }
    setLoading(false)
  }

  // Dues payments come off the balance in full (extra becomes advance credit).
  // Fees/penalties only pay off an open charge of the same type; otherwise they are a one-time fee.
  const purposeType = PAYMENT_PURPOSES.includes(form.paymentPurpose)
    ? form.paymentPurpose
    : form.paymentPurpose
      ? 'Other'
      : ''
  const isDuesPayment = !purposeType || purposeType === 'Association Dues'

  // How much of this homeowner's fee charge is still unpaid. Only this one
  // homeowner's rows are read, and the formula matches the database trigger that
  // makes the final decision: charged minus (balance_effect - effect_released).
  useEffect(() => {
    if (!form.propertyId || isDuesPayment) {
      setOpenOfType(0)
      return undefined
    }

    let cancelled = false
    const propertyId = Number(form.propertyId)

    async function loadOpenAmount() {
      const [chargeResult, paidResult] = await Promise.all([
        fetchAll(() => supabase
          .from('property_charges')
          .select('amount')
          .eq('property_id', propertyId)
          .eq('charge_type', purposeType)
          .is('voided_at', null)),
        fetchAll(() => supabase
          .from('payments')
          .select('balance_effect, effect_released')
          .eq('property_id', propertyId)
          .eq('charge_type', purposeType)
          .neq('status', 'Voided')),
      ])

      if (cancelled) return
      if (chargeResult.error || paidResult.error) {
        setOpenOfType(0)
        return
      }

      const charged = (chargeResult.data || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      const applied = (paidResult.data || []).reduce(
        (sum, row) => sum + (Number(row.balance_effect) || 0) - (Number(row.effect_released) || 0),
        0,
      )
      setOpenOfType(Math.max(Math.round((charged - applied) * 100) / 100, 0))
    }

    loadOpenAmount()
    return () => { cancelled = true }
  }, [form.propertyId, isDuesPayment, purposeType, reloadTick])

const selectedMonthlyDues =
  Number(monthlyDuesByProperty.get(Number(form.propertyId))) || 0

const annualGrossCents = Math.round(selectedMonthlyDues * 100) * 12
const annualDiscountCents = Math.round(selectedMonthlyDues * 100)
const annualPaidCents = annualGrossCents - annualDiscountCents

const annualGross = annualGrossCents / 100
const annualDiscount = annualDiscountCents / 100
const annualDiscountedPayment = annualPaidCents / 100

// Do not offer the discount when there is still a positive balance owed.
// Otherwise, part of the annual credit could be consumed by old arrears.
const canOfferAnnualDiscount =
  form.paymentPurpose === 'Association Dues' &&
  Boolean(form.propertyId) &&
  selectedMonthlyDues > 0 &&
  Number(form.previousBalance) <= 0

const effectivePaymentAmount = annualAdvance
  ? annualGross
  : Math.round((Number(form.amountPaid) || 0) * 100) / 100

  const remainingBalance = useMemo(() => {
  const previous = Number(form.previousBalance) || 0
  const paid = annualAdvance
    ? annualGross
    : Math.round((Number(form.amountPaid) || 0) * 100) / 100

  const effect =
    annualAdvance || isDuesPayment || purposeType !== 'Other'
      ? paid
      : Math.min(paid, openOfType)

  return Math.round((previous - effect) * 100) / 100
}, [
  form.previousBalance,
  form.amountPaid,
  annualAdvance,
  annualGross,
  isDuesPayment,
  purposeType,
  openOfType,
])

  // ---- Paged payment history -------------------------------------------------
  // The table shows one day at a time (50 rows per page), read straight from the database.
  //   * Default view: today's payments.
  //   * Use the arrows or the calendar button to look at another day.
  //   * Typing a search looks through ALL dates.
  const debouncedSearch = useDebouncedValue(searchTerm, 350)
  const searching = searchTokens(debouncedSearch).length > 0
  const todayKey = todayDateKey()
  const isToday = selectedDateKey === todayKey
  const scopeKind = searching ? 'search' : 'day'
  const listRange = searching ? null : dayRange(selectedDateKey)
  const scopeKey = `${scopeKind}|${selectedDateKey}|${debouncedSearch}`

  // The page number belongs to one scope; changing day/search starts at page 1.
  const page = pageState.key === scopeKey ? pageState.page : 0
  function goToPage(nextPage) {
    setPageState({ key: scopeKey, page: Math.max(0, nextPage) })
  }

  useEffect(() => {
    let cancelled = false

    async function loadRows() {
      setListLoading(true)
      const { from, to } = pageWindow(page)

      // Browsing a day gets an exact total (cheap: it uses the date index).
      // An open-ended search skips the exact count - counting every match in a big
      // table is slow and unnecessary - and asks for one extra row to learn whether
      // a next page exists.
      const exact = scopeKind !== 'search'
      let query = supabase.from('payments').select('*', exact ? { count: 'exact' } : undefined)
      query = applyTimeRange(query, 'paid_at', listRange)
      query = applySearch(query, PAYMENT_SEARCH_COLUMNS, debouncedSearch)

      // id as a tiebreaker keeps pages stable (matches the paid_at, id index).
      const { data, error, count } = await query
        .order('paid_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, exact ? to : to + 1)

      if (cancelled) return

      if (error) {
        setListError(`Could not load payments: ${error.message}`)
        setRows([])
        setPageInfo({ total: 0, minimum: 0 })
      } else if ((data || []).length === 0 && page > 0 && (!exact || (count || 0) > 0)) {
        // The page emptied (e.g. after a void): step back to the last page that has rows.
        goToPage(exact ? pageCount(count) - 1 : page - 1)
        return
      } else {
        const result = interpretPage(data, count, page, exact)
        setListError('')
        setRows(result.rows)
        setPageInfo({ total: result.total, minimum: result.minimum })
      }
      setListLoading(false)
    }

    loadRows()
    return () => { cancelled = true }
  }, [scopeKey, page, reloadTick])

  // Totals for the single day being viewed - computed by the database.
  const dayLabel = organization.formatDate(`${selectedDateKey}T12:00:00`)
  const summaryRange = dayRange(selectedDateKey)
  const summaryLabel = isToday ? 'Today' : dayLabel

  useEffect(() => {
    let cancelled = false
    setSummary(null)

    supabase
      .rpc('receipts_period_summary', { p_from: summaryRange.from, p_to: summaryRange.to })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('Could not load payment totals:', error.message)
          return
        }
        setSummary(Array.isArray(data) ? data[0] || null : data)
      })

    return () => { cancelled = true }
  }, [summaryRange.from, summaryRange.to, reloadTick])

  // Calendar dots: asked for one month at a time, only when the calendar shows it.
  const loadedMonthsRef = useRef(new Set())

  useEffect(() => {
    // A payment was added or voided: forget cached dots so they are fetched fresh.
    loadedMonthsRef.current = new Set()
    setActiveDays({})
  }, [reloadTick])

  async function loadActiveDays(year, month) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}` // month is 0-based
    if (loadedMonthsRef.current.has(key)) return
    loadedMonthsRef.current.add(key)

    const { data, error } = await supabase.rpc('receipt_active_days', {
      p_month: `${key}-01`,
      p_include_services: false,
    })

    if (error) {
      loadedMonthsRef.current.delete(key)
      return
    }
    setActiveDays((current) => ({ ...current, [key]: new Set(data || []) }))
  }

  const activeDateKeys = useMemo(() => {
    const keys = new Set()
    Object.values(activeDays).forEach((days) => days.forEach((day) => keys.add(day)))
    return keys
  }, [activeDays])

  const matchingHomeowners = useMemo(() => {
    const search = form.homeownerName.trim().toLowerCase()

    return properties
      .filter((property) => (property.homeowner_status || 'active') === 'active')
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

  // Same idea as above, for the Add Charge dialog's type-to-search homeowner field.
  const matchingChargeHomeowners = useMemo(() => {
    const search = chargeHomeownerText.trim().toLowerCase()

    return properties
      .filter((property) => (property.homeowner_status || 'active') === 'active')
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
  }, [chargeHomeownerText, properties])

  function updateField(event) {
  const { name, value } = event.target

  if (name === 'paymentPurpose') {
    setAnnualAdvance(false)
  }

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
      previousBalance: '',
    }))
    setHomeownerMenuOpen(true)
    setFormError('')
  }

  // A penalty that fell due was just posted for the selected homeowner: refresh their balance.
  async function handlePenaltiesPosted() {
    const id = form.propertyId
    if (!id) return
    const { data } = await supabase.from('properties').select('current_balance').eq('id', Number(id)).maybeSingle()
    if (!data) return
    const balance = Number(data.current_balance) || 0
    setProperties((current) =>
      current.map((property) => (String(property.id) === String(id) ? { ...property, current_balance: balance } : property)),
    )
    setForm((current) => (String(current.propertyId) === String(id) ? { ...current, previousBalance: String(balance) } : current))
  }

  function selectHomeowner(property) {
    setAnnualAdvance(false)
    setForm((current) => ({
      ...current,
      previousBalance: String(Number(property.current_balance) || 0),
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
    setAnnualAdvance(false)
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setAnnualAdvance(false)
    setShowForm(false)
    setFormError('')
  }

  function handleSelectCalendarDate(dateKey) {
    setSelectedDateKey(dateKey)
    calendar.hide()
  }

  function goToToday() {
    setSelectedDateKey(todayDateKey())
  }

  function openChargeForm() {
    if (!canManageCharges) return
    setChargeForm(EMPTY_CHARGE)
    setChargeHomeownerText('')
    setChargeMenuOpen(false)
    setChargeError('')
    setShowCharge(true)
  }

  function closeChargeForm() {
    if (chargeSaving) return
    setShowCharge(false)
  }

  function updateChargeField(event) {
    const { name, value } = event.target
    setChargeForm((current) => ({ ...current, [name]: value }))
    setChargeError('')
  }

  function updateChargeHomeownerSearch(event) {
    setChargeHomeownerText(event.target.value)
    // Typing clears the previous pick, so a homeowner must be chosen from the list.
    setChargeForm((current) => ({ ...current, propertyId: '' }))
    setChargeMenuOpen(true)
    setChargeError('')
  }

  function selectChargeHomeowner(property) {
    setChargeForm((current) => ({ ...current, propertyId: String(property.id) }))
    setChargeHomeownerText(property.homeowner_name)
    setChargeMenuOpen(false)
    setChargeError('')
  }

  async function addCharge(event) {
    event.preventDefault()

    if (!canManageCharges || !currentUser?.id) {
      setChargeError('Only an Admin or Secretary can add charges.')
      return
    }

    const amount = Math.round((Number(chargeForm.amount) + Number.EPSILON) * 100) / 100
    const property = properties.find((item) => String(item.id) === chargeForm.propertyId)

    if (!property) {
      setChargeError('Select a homeowner.')
      return
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setChargeError('Charge amount must be greater than zero.')
      return
    }

    setChargeSaving(true)
    setChargeError('')

    const { error } = await supabase.from('property_charges').insert({
      property_id: property.id,
      charge_type: chargeForm.chargeType,
      description: chargeForm.description.trim() || null,
      amount,
      created_by: currentUser.id,
      created_by_name: recorderName,
    }).select('id, property_id, charge_type, amount, billing_month, description, created_by_name, created_at').single()

    if (error) {
      setChargeError(error.message)
      setChargeSaving(false)
      return
    }

    await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: 'Charge Added',
      target: `${chargeForm.chargeType} — ${property.homeowner_name} — ${peso.format(amount)}`,
    })

    setProperties((current) =>
      current.map((item) =>
        item.id === property.id
          ? { ...item, current_balance: (Number(item.current_balance) || 0) + amount }
          : item,
      ),
    )
    setReloadTick((tick) => tick + 1)
    setShowCharge(false)
    setChargeSaving(false)
  }

  // Treasurers can record new payments but cannot void payments.
  const canVoidPayments = role === 'secretary'

  const propertyById = useMemo(
    () => new Map(properties.map((property) => [Number(property.id), property])),
    [properties],
  )

  // The charges panel reads from the database only while it is open: the 50 most
  // recent open charges, or the 50 best matches for what was typed. Each typed word
  // can match the homeowner's name, the charge type or the description.
  const debouncedChargeSearch = useDebouncedValue(chargeSearch, 350)

  useEffect(() => {
    if (!showCharges) return undefined
    let cancelled = false

    async function loadCharges() {
      setChargesLoading(true)

      let query = supabase
        .from('property_charges')
        .select('id, property_id, charge_type, amount, billing_month, description, created_by_name, created_at', { count: 'exact' })
        .is('voided_at', null)

      searchTokens(debouncedChargeSearch).forEach((token) => {
        const lower = token.toLowerCase()
        const ownerIds = properties
          .filter((property) => (property.homeowner_name || '').toLowerCase().includes(lower))
          .map((property) => Number(property.id))
          .slice(0, 500)
        const parts = [ilikeAny(['charge_type', 'description'], token)]
        if (ownerIds.length > 0) parts.push(`property_id.in.(${ownerIds.join(',')})`)
        query = query.or(parts.join(','))
      })

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(50)

      if (cancelled) return
      setChargeRows(error ? [] : data || [])
      setChargeTotal(error ? 0 : count || 0)
      setChargesLoading(false)
    }

    loadCharges()
    return () => { cancelled = true }
  }, [showCharges, debouncedChargeSearch, reloadTick])

  function openVoid(kind, item) {
    setVoidTarget({ kind, item })
    setVoidReason('')
    setVoidError('')
  }

  async function confirmVoid(event) {
    event.preventDefault()
    const reason = voidReason.trim()

    if (reason.length < 5) {
      setVoidError('Enter a reason (at least 5 characters).')
      return
    }

    setVoiding(true)
    setVoidError('')
    const { kind, item } = voidTarget

    if (kind === 'payment') {
      const { data, error } = await supabase
        .from('payments')
        .update({ status: 'Voided', void_reason: reason })
        .eq('id', item.id)
        .neq('status', 'Voided')
        .select('id')

      if (error || !data?.length) {
        setVoidError(error?.message || 'Could not void this payment. It may already be voided, or you may not have permission.')
        setVoiding(false)
        return
      }

      const effect = Number(item.balance_effect ?? item.amount_paid ?? item.amount) || 0
      setReloadTick((tick) => tick + 1)
      setProperties((current) =>
        current.map((property) =>
          Number(property.id) === Number(item.property_id)
            ? { ...property, current_balance: (Number(property.current_balance) || 0) + effect }
            : property,
        ),
      )
      await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: 'Payment Voided',
        target: `${item.receipt_number} — ${item.homeowner_name} — ${peso.format(Number(item.amount_paid) || 0)} — ${reason}`,
      })
    } else {
      const { data, error } = await supabase
        .from('property_charges')
        .update({ voided_at: new Date().toISOString(), void_reason: reason })
        .eq('id', item.id)
        .is('voided_at', null)
        .select('id')

      if (error || !data?.length) {
        setVoidError(error?.message || 'Could not void this charge. It may already be voided, or you may not have permission.')
        setVoiding(false)
        return
      }

      const owner = propertyById.get(Number(item.property_id))
      setReloadTick((tick) => tick + 1)
      setProperties((current) =>
        current.map((property) =>
          Number(property.id) === Number(item.property_id)
            ? { ...property, current_balance: (Number(property.current_balance) || 0) - (Number(item.amount) || 0) }
            : property,
        ),
      )
      await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: 'Charge Voided',
        target: `${item.charge_type} — ${owner?.homeowner_name || 'Homeowner'} — ${peso.format(Number(item.amount) || 0)} — ${reason}`,
      })
    }

    setVoiding(false)
    setVoidTarget(null)
  }

  function confirmAdvancePayment() {
    advanceApprovedRef.current = true
    setAdvanceConfirm(null)
    recordPayment({ preventDefault() {} })
  }

  async function recordPayment(event) {
    event.preventDefault()
    const advanceApproved = advanceApprovedRef.current
    advanceApprovedRef.current = false

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

    if (!Number.isFinite(previous)) {
      setFormError('Current balance is not available. Select the homeowner again.')
      return
    }

    if (!Number.isFinite(paid) || paid <= 0) {
      setFormError('Amount paid must be greater than zero.')
      return
    }
    if (annualAdvance) {
  if (!canOfferAnnualDiscount) {
    setFormError(
      'The annual discount is available only for Association Dues when no positive balance is outstanding.',
    )
    return
  }

  if (Math.round(paid * 100) !== annualPaidCents) {
    setFormError('The annual discounted amount does not match the current dues.')
    return
  }
}

    if (
  form.paymentPurpose === 'Association Dues' &&
  !annualAdvance &&
  paid > Math.max(previous, 0) &&
  !advanceApproved
) {
      setAdvanceConfirm({ credit: paid - previous, paid })
      return
    }

    if (purposeType && purposeType !== 'Association Dues' && purposeType !== 'Other' && paid > openOfType + 0.005 && !advanceApproved) {
      setAdvanceConfirm({ credit: Math.round((paid - openOfType) * 100) / 100, paid, kind: 'fee', feeType: purposeType })
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
  charge_type: PAYMENT_PURPOSES.includes(form.paymentPurpose)
    ? form.paymentPurpose
    : 'Other',
  previous_balance: previous,

  // amount is the full dues credit; amount_paid is the cash actually received.
  amount: annualAdvance ? annualGross : paid,
  amount_paid: paid,

  receipt_breakdown: annualAdvance
    ? {
        annual_advance_discount: {
          months_covered: 12,
          gross_amount: annualGross,
          discount_amount: annualDiscount,
        },
      }
    : undefined,

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

    goToPage(0)
    // Jump to today so the new receipt is visible even if another day was open.
    setSelectedDateKey(todayDateKey())
    setReloadTick((tick) => tick + 1)
    setProperties((current) =>
      current.map((property) =>
        String(property.id) === String(data.property_id)
          ? { ...property, current_balance: Number(data.remaining_balance) || 0 }
          : property,
      ),
    )
    setShowForm(false)
    setForm(EMPTY_FORM)
    setReceipt(data)
    setSaving(false)
  }

  // Preview for the Add Charge dialog: credit is used up first, then a balance remains.
  const chargeProperty = properties.find((item) => String(item.id) === chargeForm.propertyId)
  const chargePreviewAmount = Math.round((Number(chargeForm.amount) || 0) * 100) / 100
  const chargeBalanceBefore = Number(chargeProperty?.current_balance) || 0
  const chargeBalanceAfter = Math.round((chargeBalanceBefore + chargePreviewAmount) * 100) / 100
  const chargeCreditUsed = chargeBalanceBefore < 0 ? Math.min(-chargeBalanceBefore, chargePreviewAmount) : 0

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

        <div className="payments-header-actions">
          {canManageCharges && (
            <button className="payments-secondary" type="button" onClick={openChargeForm}>
              Add Charge
            </button>
          )}

          {canManageCharges && (
            <button className="payments-secondary" type="button" onClick={() => { setChargeSearch(''); setShowCharges(true) }}>
              View Charges
            </button>
          )}

          {canManagePayments && (
            <button className="payments-primary" type="button" onClick={openForm}>
              <span aria-hidden="true">+</span>
              Record Payment
            </button>
          )}
        </div>
      </header>

      {pageError && <p className="payments-error">{pageError}</p>}
      {listError && <p className="payments-error">{listError}</p>}

      <section className="payments-summary" aria-label="Payment overview">
        <article className="payments-summary-card payments-summary-collected">
          <span className="payments-summary-label">Total collected</span>
          <strong>{summary ? peso.format(Number(summary.dues_collected) || 0) : '—'}</strong>
          <small>Excludes voided payments · {summaryLabel}</small>
        </article>
        <article className="payments-summary-card payments-summary-records">
          <span className="payments-summary-label">Completed payments</span>
          <strong>{summary ? summary.completed_count : '—'}</strong>
          <small>{summary ? summary.payment_count : 0} record{summary?.payment_count === 1 ? '' : 's'} · {summaryLabel}</small>
        </article>
        <article className="payments-summary-card payments-summary-homeowners">
          <span className="payments-summary-label">Homeowners served</span>
          <strong>{summary ? summary.homeowners_served : '—'}</strong>
          <small>Unique properties collected</small>
        </article>
      </section>

      <section className="payments-table-card">
        <div className="payments-table-heading">
          <div>
            <h2>Payment history</h2>
            <p>
              {scopeKind === 'search'
                ? 'Search results across all dates.'
                : isToday
                  ? "Today's payments. Use the arrows or the calendar button for other days, or search all dates."
                  : `Payments recorded on ${dayLabel}.`}
            </p>
          </div>
          <span className="payments-result-count">
            {listLoading ? '…' : countLabel(pageInfo)}
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

          {!searching && (
            <div className="payments-day-switcher" ref={calendarAnchorRef}>
              <button
                type="button"
                aria-label="Previous day"
                disabled={listLoading}
                onClick={() => setSelectedDateKey(shiftDateKey(selectedDateKey, -1))}
              >
                ‹
              </button>
              <button
                type="button"
                className={`payments-day-label-btn ${calendar.open ? 'is-open' : ''}`}
                onClick={calendar.toggle}
                aria-expanded={calendar.open}
                aria-label="Choose a date"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                {isToday ? `Today · ${dayLabel}` : dayLabel}
              </button>
              <button
                type="button"
                aria-label="Next day"
                disabled={listLoading || selectedDateKey >= todayKey}
                onClick={() => setSelectedDateKey(shiftDateKey(selectedDateKey, 1))}
              >
                ›
              </button>
              {!isToday && (
                <button type="button" className="payments-day-today" onClick={goToToday}>
                  Today
                </button>
              )}

              {calendar.mounted && (
                <div className={`payments-calendar-animation ${calendar.visible ? 'is-visible' : ''}`}>
                  <PaymentCalendar
                    selectedDateKey={selectedDateKey}
                    activeDateKeys={activeDateKeys}
                    onSelectDate={handleSelectCalendarDate}
                    onViewMonthChange={loadActiveDays}
                  />
                </div>
              )}
            </div>
          )}

          {searching && <span className="payments-date-chip">All dates</span>}
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
            {listLoading && rows.length === 0 ? (
              <tr><td colSpan="6" className="payments-empty">Loading payments...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan="6" className="payments-empty">
                  {scopeKind === 'day' ? (
                    <>
                      <strong>No payments recorded {isToday ? 'today' : `on ${dayLabel}`}</strong>
                      <span>Use the arrows or the calendar button to check another day, or search to look through every date.</span>
                    </>
                  ) : (
                    <>
                      <strong>No matching payments</strong>
                      <span>Try a different receipt, homeowner, payment detail, or date.</span>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((payment) => (
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
                    <div className="payments-row-actions">
                      <button className="payments-link" type="button" onClick={() => setReceipt(payment)}>
                        View <span aria-hidden="true">→</span>
                      </button>
                      {canVoidPayments && payment.status !== 'Voided' && (
                        <button className="payments-link payments-link-danger" type="button" onClick={() => openVoid('payment', payment)}>
                          <span className="payments-void-mark" aria-hidden="true">×</span>
                          Void
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <Pager page={page} total={pageInfo.total} onPageChange={goToPage} disabled={listLoading} />
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

              {form.propertyId && (
                <div className="payment-span-2">
                  <BalanceBreakdown propertyId={form.propertyId} postDue compact onPosted={handlePenaltiesPosted} />
                </div>
              )}

              <label>Current Balance
                <input
                  name="previousBalance"
                  type="text"
                  value={form.propertyId ? formatBalance(Number(form.previousBalance) || 0) : ''}
                  placeholder="Select a homeowner first"
                  disabled
                  readOnly
                />
              </label>

                    {canOfferAnnualDiscount && (
      <div className="payment-span-2 annual-advance-option">
        <label className="annual-advance-toggle">
          <input
            type="checkbox"
            checked={annualAdvance}
            onChange={(event) => {
              const enabled = event.target.checked
              setAnnualAdvance(enabled)
              setForm((current) => ({
                ...current,
                amountPaid: enabled
                  ? annualDiscountedPayment.toFixed(2)
                  : '',
                coveragePeriod: enabled
                  ? '12-month advance payment (1 month free)'
                  : '',
              }))
              setFormError('')
            }}
          />
          <span>
            <strong>12-month advance payment — 1 month free</strong>
            <small>
              Available for this homeowner's Association Dues.
            </small>
          </span>
        </label>

        <dl className="annual-advance-breakdown">
          <div>
            <dt>Regular dues for 12 months</dt>
            <dd>{peso.format(annualGross)}</dd>
          </div>
          <div>
            <dt>One month free</dt>
            <dd>− {peso.format(annualDiscount)}</dd>
          </div>
          <div className="annual-advance-total">
            <dt>Amount to collect</dt>
            <dd>{peso.format(annualDiscountedPayment)}</dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>12 months</dd>
          </div>
        </dl>
      </div>
    )}

              <label>Amount paid
  <input
    name="amountPaid"
    type="number"
    min="0.01"
    step="0.01"
    value={form.amountPaid}
    onChange={updateField}
    readOnly={annualAdvance}
    required
  />
</label>

              <div className="payment-balance-preview payment-span-2">
                <span>{remainingBalance < 0 ? 'Advance credit after payment' : 'Remaining balance after payment'}</span>
                <strong>{formatBalance(remainingBalance)}</strong>
              </div>

              {form.propertyId && isDuesPayment && remainingBalance < 0 && (
                <div className="payment-credit-note payment-span-2" role="status">
                  <strong>Advance payment</strong>
                  <span>{advanceCreditNote(-remainingBalance, duesSettingsFor(form.propertyId))}</span>
                </div>
              )}

              {form.propertyId && !isDuesPayment && Number(form.amountPaid) > 0 && (
                <div className="payment-credit-note payment-span-2" role="status">
                  <strong>{purposeType}</strong>
                  <span>
                    {purposeType !== 'Other'
                      ? (openOfType > 0
                        ? `This homeowner has an open ${purposeType} charge of ${peso.format(openOfType)}. ${Number(form.amountPaid) > openOfType ? `The extra ${peso.format(Number(form.amountPaid) - openOfType)} will be saved as advance credit.` : 'The full amount will be applied to it.'}`
                        : `No open ${purposeType} charge for this homeowner. The full amount will be saved as advance credit.`)
                      : (openOfType > 0
                        ? `This homeowner has an open ${purposeType} charge of ${peso.format(openOfType)}. ${peso.format(Math.min(Number(form.amountPaid) || 0, openOfType))} of this payment will be applied to it${Number(form.amountPaid) > openOfType ? `; the extra ${peso.format(Number(form.amountPaid) - openOfType)} is recorded as a one-time fee.` : '.'}`
                        : `No open ${purposeType} charge for this homeowner. This is recorded as a one-time fee and does not change their dues balance.`)}
                  </span>
                </div>
              )}

              {form.propertyId && !isDuesPayment && Number(form.previousBalance) < 0 && (
                <div className="payment-credit-note payment-span-2" role="status">
                  <strong>Advance credit on file</strong>
                  <span>
                    This homeowner has {peso.format(-Number(form.previousBalance))} of credit, and new charges are deducted from it automatically.
                    Collect this fee in cash only if the homeowner wants to pay it separately.
                  </span>
                </div>
              )}

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

      {showCharge && canManageCharges && (
        <div className="payments-overlay" onMouseDown={closeChargeForm}>
          <form className="payment-form" onSubmit={addCharge} onMouseDown={(e) => e.stopPropagation()} autoComplete="off">
            <div className="payment-modal-heading">
              <div>
                <h2>Add Charge</h2>
                <p>Adds an amount owed to the homeowner's Current Balance. Monthly dues are added automatically.</p>
              </div>
              <button type="button" className="payments-close" onClick={closeChargeForm}>×</button>
            </div>

            <div className="payment-form-grid">
              <div className="payment-homeowner-field payment-span-2">
                <label htmlFor="charge-homeowner-search">Homeowner</label>
                <div className="payment-homeowner-combobox">
                  <input
                    id="charge-homeowner-search"
                    type="search"
                    value={chargeHomeownerText}
                    onChange={updateChargeHomeownerSearch}
                    onFocus={() => setChargeMenuOpen(true)}
                    onBlur={() => window.setTimeout(() => setChargeMenuOpen(false), 120)}
                    placeholder="Search homeowner name, block, or lot..."
                    maxLength="120"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={chargeMenuOpen}
                    aria-controls="charge-homeowner-options"
                    required
                  />

                  {chargeMenuOpen && (
                    <div className="payment-homeowner-options" id="charge-homeowner-options" role="listbox">
                      {loading ? (
                        <p className="payment-homeowner-empty">Loading ledger homeowners...</p>
                      ) : matchingChargeHomeowners.length === 0 ? (
                        <p className="payment-homeowner-empty">No matching homeowner found in the ledger.</p>
                      ) : (
                        matchingChargeHomeowners.map((property) => (
                          <button
                            type="button"
                            className={`payment-homeowner-option ${
                              String(property.id) === chargeForm.propertyId ? 'is-selected' : ''
                            }`}
                            key={property.id}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectChargeHomeowner(property)}
                            role="option"
                            aria-selected={String(property.id) === chargeForm.propertyId}
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
                  Type a name, block, or lot, then pick a homeowner from the list.
                </small>
              </div>

              <label>Charge Type
                <select name="chargeType" value={chargeForm.chargeType} onChange={updateChargeField}>
                  {CHARGE_TYPES.map((purpose) => (
                    <option key={purpose}>{purpose}</option>
                  ))}
                </select>
              </label>

              <label>Amount
                <input name="amount" type="number" min="0.01" step="0.01" value={chargeForm.amount} onChange={updateChargeField} required />
              </label>

              {chargeProperty && chargePreviewAmount > 0 && (
                <div className="payment-balance-preview payment-span-2">
                  <span>
                    {chargeCreditUsed > 0
                      ? `${peso.format(chargeCreditUsed)} of the homeowner's credit will be applied automatically. `
                      : ''}
                    {chargeBalanceAfter < 0 ? 'Advance credit left after charge' : 'Balance owed after charge'}
                  </span>
                  <strong>{formatBalance(chargeBalanceAfter)}</strong>
                </div>
              )}

              <label className="payment-span-2">Description (Optional)
                <input name="description" value={chargeForm.description} onChange={updateChargeField} maxLength="250" placeholder="e.g., Noise violation, July 2026" />
              </label>
            </div>

            {chargeError && <p className="payments-error">{chargeError}</p>}

            <div className="payment-actions">
              <button type="button" className="payments-secondary" onClick={closeChargeForm} disabled={chargeSaving}>Cancel</button>
              <button type="submit" className="payments-primary" disabled={chargeSaving}>{chargeSaving ? 'Saving...' : 'Add Charge'}</button>
            </div>
          </form>
        </div>
      )}

      {showCharges && canManageCharges && (
        <div className="payments-overlay" onMouseDown={() => setShowCharges(false)}>
          <section className="payment-form charge-list-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="payment-modal-heading">
              <div>
                <h2>Charges</h2>
                <p>Charges added to homeowner balances. Void a charge that was added or billed by mistake.</p>
              </div>
              <button type="button" className="payments-close" onClick={() => setShowCharges(false)}>×</button>
            </div>

            <input
              className="charge-list-search"
              placeholder="Search homeowner, type, or description..."
              value={chargeSearch}
              onChange={(e) => setChargeSearch(e.target.value)}
            />

            <div className="charge-list">
              {chargesLoading && chargeRows.length === 0 ? (
                <p className="charge-list-empty">Loading charges...</p>
              ) : chargeRows.length === 0 ? (
                <p className="charge-list-empty">No charges found.</p>
              ) : (
                chargeRows.map((charge) => {
                  const owner = propertyById.get(Number(charge.property_id))
                  return (
                    <div className="charge-list-row" key={charge.id}>
                      <div>
                        <strong>{owner?.homeowner_name || 'Unknown homeowner'}</strong>
                        <small>
                          {charge.charge_type}
                          {charge.billing_month ? ` · ${String(charge.billing_month).slice(0, 7)}` : ''}
                          {charge.description ? ` · ${charge.description}` : ''}
                        </small>
                        <small>{organization.formatDate(charge.created_at)} · {charge.created_by_name || 'System'}</small>
                      </div>
                      <strong className="charge-list-amount">{peso.format(Number(charge.amount) || 0)}</strong>
                      <button type="button" className="payments-link payments-link-danger" onClick={() => openVoid('charge', charge)}>Void</button>
                    </div>
                  )
                })
              )}
              {!chargesLoading && chargeTotal > chargeRows.length && (
                <p className="charge-list-empty">
                  Showing the {chargeRows.length} most recent of {chargeTotal.toLocaleString('en-PH')} open charges. Search to narrow the list.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {voidTarget && (
        <div className="payments-overlay advance-overlay" onMouseDown={() => !voiding && setVoidTarget(null)}>
          <form className="advance-dialog void-dialog" onSubmit={confirmVoid} onMouseDown={(e) => e.stopPropagation()}>
            <div className="advance-icon void-icon" aria-hidden="true">!</div>
            <h2>{voidTarget.kind === 'payment' ? 'Void payment' : 'Void charge'}</h2>
            <p className="advance-lead">
              {voidTarget.kind === 'payment'
                ? `${voidTarget.item.receipt_number} — ${voidTarget.item.homeowner_name} — ${peso.format(Number(voidTarget.item.amount_paid) || 0)}`
                : `${voidTarget.item.charge_type} — ${propertyById.get(Number(voidTarget.item.property_id))?.homeowner_name || 'Homeowner'} — ${peso.format(Number(voidTarget.item.amount) || 0)}`}
              <br />
              {voidTarget.kind === 'payment'
                ? "The homeowner's balance is corrected automatically. This cannot be undone."
                : 'This removes the charge from the homeowner\'s balance. It does not cancel any payment — to undo a payment, use Void on the payment itself. This cannot be undone.'}
            </p>
            <label className="void-reason">Reason (required)
              <textarea value={voidReason} onChange={(e) => { setVoidReason(e.target.value); setVoidError('') }} rows="3" maxLength="250" placeholder="e.g., Wrong amount typed" autoFocus />
            </label>
            {voidError && <p className="payments-error">{voidError}</p>}
            <div className="advance-actions">
              <button type="button" className="payments-secondary" onClick={() => setVoidTarget(null)} disabled={voiding}>Cancel</button>
              <button type="submit" className="payments-primary void-confirm" disabled={voiding}>{voiding ? 'Voiding...' : 'Void'}</button>
            </div>
          </form>
        </div>
      )}

      {advanceConfirm && (() => {
        const isFee = advanceConfirm.kind === 'fee'
        const d = isFee ? { credit: advanceConfirm.credit } : advanceCreditDetails(advanceConfirm.credit, duesSettingsFor(form.propertyId))
        return (
          <div className="payments-overlay advance-overlay" onMouseDown={() => setAdvanceConfirm(null)}>
            <section className="advance-dialog" role="dialog" aria-modal="true" aria-labelledby="advance-title" onMouseDown={(e) => e.stopPropagation()}>
              <div className="advance-icon" aria-hidden="true">₱</div>
              <h2 id="advance-title">Advance payment</h2>
              <p className="advance-lead">{isFee ? `This payment is more than the open ${advanceConfirm.feeType} charge. The extra will be saved as advance credit.` : 'This payment is more than what the homeowner owes. The extra will be saved as credit.'}</p>

              <div className="advance-amount">
                <span>{isFee ? 'Extra saved as advance credit' : 'Advance credit after this payment'}</span>
                <strong>{peso.format(d.credit)}</strong>
              </div>

              {isFee ? (
                <p className="advance-coverage">It will be deducted automatically from this homeowner's next charges.</p>
              ) : d.hasSettings ? (
                <>
                  <dl className="advance-details">
                    <div><dt>Deducted on</dt><dd>{d.billing}</dd></div>
                    <div><dt>Monthly dues</dt><dd>{peso.format(d.dues)}</dd></div>
                    <div><dt>Dues date</dt><dd>{d.due}</dd></div>
                    <div><dt>Grace period</dt><dd>{d.grace > 0 ? `${d.grace} days (until ${d.deadline})` : 'None'}</dd></div>
                  </dl>
                  {d.dues > 0 && (
                    <p className="advance-coverage">
                      {d.months > 0
                        ? `Covers ${d.months} full month${d.months > 1 ? 's' : ''} of dues${d.rest > 0 ? `, plus ${peso.format(d.rest)} toward the next.` : '.'}`
                        : `Less than one month of dues — ${peso.format(d.shortfall)} will still be due after the deduction.`}
                    </p>
                  )}
                </>
              ) : (
                <p className="advance-coverage">It will be deducted automatically when the next monthly dues are billed.</p>
              )}

              <div className="advance-actions">
                <button type="button" className="payments-secondary" onClick={() => setAdvanceConfirm(null)}>Go back</button>
                <button type="button" className="payments-primary" onClick={confirmAdvancePayment} autoFocus>Confirm payment</button>
              </div>
            </section>
          </div>
        )
      })()}

      {receipt && (() => {
        const receiptModel = buildReceiptModel('payment', receipt, organization, {
          advanceNote:
            Number(receipt.remaining_balance) < 0 && (!receipt.charge_type || receipt.charge_type === 'Association Dues')
              ? advanceCreditNote(-Number(receipt.remaining_balance), duesSettingsFor(receipt.property_id ?? form.propertyId))
              : '',
        })
        return (
          <ReceiptDialog
            model={receiptModel}
            onClose={() => setReceipt(null)}
            onPrint={() => printReceipt(receiptModel, setPopupNotice)}
          >
            {canVoidPayments && receipt.status !== 'Voided' && (
              <button
                type="button"
                className="rcpt-btn rcpt-btn-danger"
                onClick={() => {
                  const target = receipt
                  setReceipt(null)
                  openVoid('payment', target)
                }}
              >
                Void this payment
              </button>
            )}
          </ReceiptDialog>
        )
      })()}

      <ActionDialog
        open={!!popupNotice}
        title="Pop-up Blocked"
        message={popupNotice}
        onConfirm={() => setPopupNotice('')}
      />
    </div>
  )
}