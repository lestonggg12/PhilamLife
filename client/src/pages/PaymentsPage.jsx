import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { advanceCreditDetails, advanceCreditNote } from '../lib/advanceCredit'
import { useOrganization } from '../context/OrganizationContext'
import './PaymentsPage.css'
import useAnimatedPopover from '../hooks/useAnimatedPopover'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { MonthSwitcher, Pager } from '../components/PagerControls'
import {
  applySearch,
  applyTimeRange,
  countLabel,
  currentManilaMonthKey,
  dayRange,
  ilikeAny,
  interpretPage,
  monthLabel,
  monthRange,
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
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  // One page (50) of payments at a time, read from the database.
  const [rows, setRows] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, minimum: 0 })
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [monthKey, setMonthKey] = useState(() => currentManilaMonthKey())
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
  const [duesSettings, setDuesSettings] = useState(null)
  const [advanceConfirm, setAdvanceConfirm] = useState(null)
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
  const [homeownerMenuOpen, setHomeownerMenuOpen] = useState(false)
  const [selectedDateKey, setSelectedDateKey] = useState('')
  const calendar = useAnimatedPopover()
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

    const [propertyResult, settingsResult, billedResult] = await Promise.all([
      fetchAll(() => supabase
        .from('properties')
        .select('id, homeowner_name, block, lot_number, homeowner_status, current_balance')
        .order('homeowner_name')),
      supabase
        .from('system_settings')
        .select('dues_amount, billing_day, due_day, grace_period_days')
        .eq('id', 1)
        .maybeSingle(),
      // Has this month's dues run already? (decides which billing date the advance note shows)
      supabase
        .from('property_charges')
        .select('id')
        .eq('billing_month', `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 7)}-01`)
        .limit(1),
    ])

    if (!settingsResult.error && settingsResult.data) {
      setDuesSettings({
        ...settingsResult.data,
        billed_this_month: !billedResult.error && (billedResult.data || []).length > 0,
      })
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

  const remainingBalance = useMemo(() => {
    const previous = Number(form.previousBalance) || 0
    const paid = Number(form.amountPaid) || 0
    const effect = isDuesPayment ? paid : Math.min(paid, openOfType)
    return previous - effect
  }, [form.previousBalance, form.amountPaid, isDuesPayment, openOfType])

  // ---- Paged payment history -------------------------------------------------
  // The table shows one page (50 rows) at a time, read straight from the database.
  //   * Default view: the selected month (this month when the page opens).
  //   * Typing a search looks through ALL months.
  //   * Picking a calendar date shows that one day.
  const debouncedSearch = useDebouncedValue(searchTerm, 350)
  const searching = searchTokens(debouncedSearch).length > 0
  const scopeKind = selectedDateKey ? 'day' : searching ? 'search' : 'month'
  const listRange = selectedDateKey
    ? dayRange(selectedDateKey)
    : searching
      ? null
      : monthRange(monthKey)
  const scopeKey = `${scopeKind}|${monthKey}|${selectedDateKey}|${debouncedSearch}`

  // The page number belongs to one scope; changing month/search/date starts at page 1.
  const page = pageState.key === scopeKey ? pageState.page : 0
  function goToPage(nextPage) {
    setPageState({ key: scopeKey, page: Math.max(0, nextPage) })
  }

  useEffect(() => {
    let cancelled = false

    async function loadRows() {
      setListLoading(true)
      const { from, to } = pageWindow(page)

      // Browsing a month or a day gets an exact total (cheap: it uses the date index).
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

  // Totals for the month (or the single day) being viewed - computed by the database.
  const summaryRange = selectedDateKey ? dayRange(selectedDateKey) : monthRange(monthKey)
  const summaryLabel = selectedDateKey
    ? organization.formatDate(`${selectedDateKey}T12:00:00`)
    : monthLabel(monthKey)

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

  function handleMonthChange(nextMonthKey) {
    setMonthKey(nextMonthKey)
  }

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
      previousBalance: '',
    }))
    setHomeownerMenuOpen(true)
    setFormError('')
  }

  function selectHomeowner(property) {
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
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setFormError('')
  }

  function handleSelectCalendarDate(dateKey) {
    setSelectedDateKey(dateKey)
    calendar.hide()
  }

  function clearDateFilter() {
    setSelectedDateKey('')
  }

  function openChargeForm() {
    if (!canManagePayments) return
    setChargeForm(EMPTY_CHARGE)
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

  async function addCharge(event) {
    event.preventDefault()

    if (!canManagePayments || !currentUser?.id) {
      setChargeError('Only an Admin, Secretary, or Treasurer can add charges.')
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

  const canVoidPayments = role === 'secretary' || role === 'treasurer'

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

    if (form.paymentPurpose === 'Association Dues' && paid > Math.max(previous, 0) && !advanceApproved) {
      setAdvanceConfirm({ credit: paid - previous, paid })
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
      charge_type: PAYMENT_PURPOSES.includes(form.paymentPurpose) ? form.paymentPurpose : 'Other',
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

    goToPage(0)
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
            onClick={calendar.toggle}
            aria-expanded={calendar.open}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            View by Date
          </button>

          {canManagePayments && (
            <button className="payments-secondary" type="button" onClick={openChargeForm}>
              Add Charge
            </button>
          )}

          {canManagePayments && (
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
                ? 'Search results across all months.'
                : scopeKind === 'day'
                  ? 'Payments recorded on the selected day.'
                  : `Payments recorded in ${monthLabel(monthKey)}. Search to look through every month.`}
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

          {!selectedDateKey && !searching && (
            <MonthSwitcher monthKey={monthKey} onChange={handleMonthChange} disabled={listLoading} />
          )}

          {!selectedDateKey && searching && (
            <span className="payments-date-chip">All months</span>
          )}

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
            {listLoading && rows.length === 0 ? (
              <tr><td colSpan="6" className="payments-empty">Loading payments...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan="6" className="payments-empty">
                  {scopeKind === 'month' ? (
                    <>
                      <strong>No payments recorded in {monthLabel(monthKey)}</strong>
                      <span>Use the arrows to view another month, or search to look through every month.</span>
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

              <label>Amount paid
                <input name="amountPaid" type="number" min="0.01" step="0.01" value={form.amountPaid} onChange={updateField} required />
              </label>

              <div className="payment-balance-preview payment-span-2">
                <span>{remainingBalance < 0 ? 'Advance credit after payment' : 'Remaining balance after payment'}</span>
                <strong>{formatBalance(remainingBalance)}</strong>
              </div>

              {form.propertyId && isDuesPayment && remainingBalance < 0 && (
                <div className="payment-credit-note payment-span-2" role="status">
                  <strong>Advance payment</strong>
                  <span>{advanceCreditNote(-remainingBalance, duesSettings)}</span>
                </div>
              )}

              {form.propertyId && !isDuesPayment && Number(form.amountPaid) > 0 && (
                <div className="payment-credit-note payment-span-2" role="status">
                  <strong>{purposeType}</strong>
                  <span>
                    {openOfType > 0
                      ? `This homeowner has an open ${purposeType} charge of ${peso.format(openOfType)}. ${peso.format(Math.min(Number(form.amountPaid) || 0, openOfType))} of this payment will be applied to it${Number(form.amountPaid) > openOfType ? `; the extra ${peso.format(Number(form.amountPaid) - openOfType)} is recorded as a one-time fee.` : '.'}`
                      : `No open ${purposeType} charge for this homeowner. This is recorded as a one-time fee and does not change their dues balance.`}
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

      {showCharge && canManagePayments && (
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
              <label className="payment-span-2">Homeowner
                <select name="propertyId" value={chargeForm.propertyId} onChange={updateChargeField} required>
                  <option value="">Select homeowner</option>
                  {properties
                    .filter((property) => property.homeowner_status === 'active')
                    .map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.homeowner_name} — {property.block}, Lot {property.lot_number}
                      </option>
                    ))}
                </select>
              </label>

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

      {showCharges && canManagePayments && (
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
        const d = advanceCreditDetails(advanceConfirm.credit, duesSettings)
        return (
          <div className="payments-overlay advance-overlay" onMouseDown={() => setAdvanceConfirm(null)}>
            <section className="advance-dialog" role="dialog" aria-modal="true" aria-labelledby="advance-title" onMouseDown={(e) => e.stopPropagation()}>
              <div className="advance-icon" aria-hidden="true">₱</div>
              <h2 id="advance-title">Advance payment</h2>
              <p className="advance-lead">This payment is more than what the homeowner owes. The extra will be saved as credit.</p>

              <div className="advance-amount">
                <span>Advance credit after this payment</span>
                <strong>{peso.format(d.credit)}</strong>
              </div>

              {d.hasSettings ? (
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
                <div><span>{Number(receipt.remaining_balance) < 0 ? 'Advance credit' : 'Remaining balance'}</span><strong>{peso.format(Math.abs(Number(receipt.remaining_balance) || 0))}</strong></div>
              </div>

              {Number(receipt.remaining_balance) < 0 && (!receipt.charge_type || receipt.charge_type === 'Association Dues') && (
                <p className="receipt-note">
                  <strong>Advance credit:</strong> {advanceCreditNote(-Number(receipt.remaining_balance), duesSettings)}
                </p>
              )}

              {receipt.note && <p className="receipt-note"><strong>Note:</strong> {receipt.note}</p>}
              {receipt.status === 'Voided' && receipt.void_reason && (
                <p className="receipt-note"><strong>Voided:</strong> {receipt.void_reason}</p>
              )}

              <footer className="receipt-footer">
                <div><span>Recorded by</span><strong>{receipt.recorded_by_name}</strong></div>
                <p>This computer-generated receipt is based on the payment saved in the system.</p>
              </footer>
            </div>

            <div className="receipt-actions">
              <button type="button" className="payments-secondary" onClick={() => setReceipt(null)}>Close</button>
              {canVoidPayments && receipt.status !== 'Voided' && (
                <button
                  type="button"
                  className="payments-secondary payments-link-danger"
                  onClick={() => {
                    const target = receipt
                    setReceipt(null)
                    openVoid('payment', target)
                  }}
                >
                  Void this payment
                </button>
              )}
              <button type="button" className="payments-primary" onClick={() => window.print()}>Print / Save as PDF</button>
            </div>
          </article>
        </div>
      )}
    </div>
  )
}