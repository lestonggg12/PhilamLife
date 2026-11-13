import { ReceiptText } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import DateField from '../components/DateField'
import {
  CreditCard,
  Eye,
  FileText,
  Printer,
  Search,
  RefreshCw,
  X,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useSettledAmountStatus } from '../lib/useSettledAmount'
import { useOrganization } from '../context/OrganizationContext'
import { formatDate as formatDateValue } from '../config/organization'
import ActionDialog from '../components/ActionDialog'
import { ReceiptDialog } from '../components/ReceiptSheet'
import Skeleton from '../components/skeleton/Skeleton'
import { loadPaymentReceipt } from '../lib/paymentReceipt'
import { buildReceiptModel } from '../lib/receiptModel'
import { printReceipt } from '../lib/printReceipt'
import { recordReceiptActivity } from '../lib/receiptActivityAudit'
import ServiceVoidDialog from '../components/ServiceVoidDialog'
import OfficialRegularVoidDialog from '../components/OfficialRegularVoidDialog'
import './OfficialReceiptsPage.css'
import useAnimatedPopover from '../hooks/useAnimatedPopover'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { MonthSwitcher, Pager } from '../components/PagerControls'
import {
  applySearch,
  applyTimeRange,
  countLabel,
  currentManilaMonthKey,
  dateSpanRange,
  interpretPage,
  monthLabel,
  monthRange,
  pageCount,
  pageWindow,
  searchTokens,
} from '../lib/pagedQuery'

// Columns the receipt search looks through (every typed word must match one of them).
const RECEIPT_SEARCH_COLUMNS = [
  'receipt_number',
  'payer',
  'property_label',
  'description',
  'payment_method',
  'reference_number',
  'recorded_by_name',
]

// Open-ended custom date ranges use these far-apart bounds for the totals.
const EARLIEST = '1970-01-01T00:00:00+08:00'
const LATEST = '2100-01-01T00:00:00+08:00'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const calendarDate = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const CALENDAR_MONTH_LABEL = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const normalize = (value) =>
  String(value ?? '').trim().toLowerCase()

function formatDateTime(value, dateFormat) {
  if (!value) return 'Date unavailable'

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? 'Date unavailable'
    : formatDateValue(parsed, { dateFormat, withTime: true })
}

function formatDateOnly(value) {
  if (!value) return 'Not specified'

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/,
  )

  if (match) {
    const [, year, month, day] = match

    return calendarDate.format(
      new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          12,
        ),
      ),
    )
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? String(value)
    : calendarDate.format(parsed)
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function dateKeyOf(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

// Single source of truth for "what Manila calendar date is this
// JS Date on". toManilaDateKey (used for saved receipt timestamps)
// and manilaToday (used by the calendar's "today"/"jump to today")
// both read through here, so they can never disagree.
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

function paymentProperty(payment) {
  return (
    [payment.block_name, payment.lot_number]
      .filter(Boolean)
      .join(', ') || 'Not specified'
  )
}

function serviceProperty(transaction) {
  const lot = transaction.lot_number
    ? /^lot\s/i.test(String(transaction.lot_number))
      ? transaction.lot_number
      : `Lot ${transaction.lot_number}`
    : ''

  return (
    [transaction.block_name, lot]
      .filter(Boolean)
      .join(', ') || 'Not specified'
  )
}

function mapPaymentReceipt(payment) {
  const receipt = {
    id: `payment-${payment.id}`,
    sourceId: payment.id,
    type: 'payment',
    typeLabel: 'Regular Payment',
    title: 'HOA Payment Receipt',
    receiptNumber:
      payment.receipt_number ||
      'Receipt number unavailable',
    issuedAt: payment.paid_at,
    issuedDateKey: toManilaDateKey(payment.paid_at),
    payer:
      payment.homeowner_name ||
      'Unnamed homeowner',
    property: paymentProperty(payment),
    description:
      payment.coverage_period ||
      'Homeowner payment',
    amount: Number(payment.amount_paid) || 0,
    method:
      payment.payment_method ||
      'Not specified',
    referenceNumber:
      payment.reference_number || '',
    recordedBy:
      payment.recorded_by_name ||
      'Staff member',
    isVoided: payment.status === 'Voided',
    raw: payment,
  }

  receipt.searchText = normalize(
    [
      receipt.receiptNumber,
      receipt.payer,
      receipt.property,
      receipt.description,
      receipt.method,
      receipt.referenceNumber,
      receipt.recordedBy,
    ].join(' '),
  )

  return receipt
}

/**
 * One line of the paged list (a row of the official_receipts_feed view).
 * It has what the table needs; the full record - previous balance, notes,
 * service times, etc. - is fetched only when a receipt is opened (see openReceipt).
 */
function mapFeedRow(row) {
  const isService = row.kind === 'service'

  return {
    id: `${row.kind}-${row.source_id}`,
    sourceId: row.source_id,
    type: isService ? 'service' : 'payment',
    typeLabel: isService ? 'Service Payment' : 'Regular Payment',
    title: isService ? 'HOA Service Receipt' : 'HOA Payment Receipt',
    receiptNumber: row.receipt_number || 'Receipt number unavailable',
    issuedAt: row.paid_at,
    issuedDateKey: toManilaDateKey(row.paid_at),
    payer: row.payer || 'Unnamed homeowner',
    property: row.property_label || 'Not specified',
    description: row.description || (isService ? 'Village service' : 'Homeowner payment'),
    amount: Number(row.amount_paid) || 0,
    method: row.payment_method || 'Not specified',
    referenceNumber: row.reference_number || '',
    recordedBy: row.recorded_by_name || 'Staff member',
    isVoided: Boolean(row.is_voided),
  }
}

function mapServiceReceipt(transaction) {
  const receipt = {
    id: `service-${transaction.id}`,
    sourceId: transaction.id,
    type: 'service',
    typeLabel: 'Service Payment',
    title: 'HOA Service Receipt',
    receiptNumber:
      transaction.receipt_number ||
      'Receipt number unavailable',
    issuedAt: transaction.paid_at,
    issuedDateKey: toManilaDateKey(
      transaction.paid_at,
    ),
    payer:
      transaction.customer_name ||
      'Unnamed homeowner',
    property: serviceProperty(transaction),
    description:
      transaction.service_name ||
      'Village service',
    amount:
      Number(transaction.amount_paid) || 0,
    method:
      transaction.payment_method ||
      'Not specified',
    referenceNumber:
      transaction.reference_number || '',
    recordedBy:
      transaction.recorded_by_name ||
      'Staff member',
    raw: transaction,
  }

  receipt.searchText = normalize(
    [
      receipt.receiptNumber,
      receipt.payer,
      receipt.property,
      receipt.description,
      receipt.method,
      receipt.referenceNumber,
      receipt.recordedBy,
      transaction.payment_status,
      transaction.service_date,
    ].join(' '),
  )

  return receipt
}

function ReceiptCalendar({
  selectedDateKey,
  activeDateKeys,
  onSelectDate,
  onClose,
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
      className="official-calendar-popover"
      role="dialog"
      aria-label="View receipts by date"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="official-calendar-nav">
        <button
          type="button"
          className="official-calendar-nav-button"
          onClick={goToPrevMonth}
          aria-label="Previous month"
        >
          ‹
        </button>

        <span className="official-calendar-title">
          {CALENDAR_MONTH_LABEL.format(
            new Date(viewYear, viewMonth, 1),
          )}
        </span>

        <button
          type="button"
          className="official-calendar-nav-button"
          onClick={goToNextMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="official-calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      {weeks.map((week, weekIndex) => (
        <div
          className="official-calendar-grid"
          key={`week-${weekIndex}`}
        >
          {week.map((cell) => {
            const isSelected =
              cell.dateKey === selectedDateKey
            const isToday = cell.dateKey === todayKey
            const hasReceipts = activeDateKeys.has(
              cell.dateKey,
            )

            const classNames = [
              'official-calendar-day',
              cell.outside
                ? 'official-calendar-day-outside'
                : '',
              isToday ? 'official-calendar-day-today' : '',
              isSelected
                ? 'official-calendar-day-selected'
                : '',
              hasReceipts && !cell.outside
                ? 'official-calendar-day-dot'
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

      <div className="official-calendar-legend">
        <span>
          <span className="official-calendar-legend-today" />
          Today
        </span>

        <span>
          <span className="official-calendar-legend-dot" />
          Has activity
        </span>
      </div>

      <button
        type="button"
        className="official-calendar-jump"
        onClick={jumpToToday}
      >
        Jump to Today
      </button>
    </div>
  )
}

export default function OfficialReceiptsPage({ user }) {
  const { organization } = useOrganization()
  const role = user?.is_active === false ? '' : String(user?.role || '').trim().toLowerCase()
  const canVoidReceipt = (kind) => role === 'secretary' || (role === 'treasurer' && kind === 'service')
  // One page (50) of receipts at a time, read from the database.
  const [rows, setRows] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, minimum: 0 })
  const [monthKey, setMonthKey] = useState(() => currentManilaMonthKey())
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [summary, setSummary] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [activeDays, setActiveDays] = useState({})
  const [summaryError, setSummaryError] = useState('')
  const [openingId, setOpeningId] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [listError, setListError] = useState('')
  const [popupNotice, setPopupNotice] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] =
    useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedReceipt, setSelectedReceipt] =
    useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const settlement = useSettledAmountStatus(selectedReceipt?.type === 'service' ? selectedReceipt.raw : null)
  const calendar = useAnimatedPopover()
  const calendarAnchorRef = useRef(null)

  useEffect(() => {
    if (!selectedReceipt) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedReceipt])

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
    document.addEventListener(
      'mousedown',
      handleOutsideClick,
    )

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown,
      )
      document.removeEventListener(
        'mousedown',
        handleOutsideClick,
      )
    }
  }, [calendar.open])

  // ---- Paged receipts --------------------------------------------------------
  //   * Default view: the selected month (this month when the page opens).
  //   * Typing a search (without a date range) looks through ALL months.
  //   * A From/To range or a calendar date limits the list to those days.
  const debouncedSearch = useDebouncedValue(search, 350)
  const searching = searchTokens(debouncedSearch).length > 0
  const invalidDateRange = Boolean(fromDate && toDate && fromDate > toDate)
  const hasCustomRange = Boolean(fromDate || toDate)
  const customRange = invalidDateRange ? null : dateSpanRange(fromDate, toDate)
  const scopeKind = hasCustomRange ? 'range' : searching ? 'search' : 'month'
  const listRange = hasCustomRange ? customRange : searching ? null : monthRange(monthKey)
  const scopeKey = `${scopeKind}|${monthKey}|${fromDate}|${toDate}|${typeFilter}|${debouncedSearch}`

  const filtersActive = Boolean(search || typeFilter !== 'all' || fromDate || toDate)

  // The page number belongs to one scope; changing month/search/filters starts at page 1.
  const page = pageState.key === scopeKey ? pageState.page : 0
  function goToPage(nextPage) {
    setPageState({ key: scopeKey, page: Math.max(0, nextPage) })
  }

  useEffect(() => {
    if (invalidDateRange) {
      setListError('')
      setRows([])
      setPageInfo({ total: 0, minimum: 0 })
      setLoading(false)
      return undefined
    }

    let cancelled = false

    async function loadRows() {
      setLoading(true)
      setListError('')
      setRows([])
      try {
      const { from, to } = pageWindow(page)

      // Browsing a month or a date range gets an exact total (cheap: it uses the date
      // index). An open-ended search skips the exact count and asks for one extra row
      // to learn whether a next page exists.
      const exact = scopeKind !== 'search'
      let query = supabase.from('official_receipts_feed').select('*', exact ? { count: 'exact' } : undefined)
      if (typeFilter !== 'all') query = query.eq('kind', typeFilter)
      query = applyTimeRange(query, 'paid_at', listRange)
      query = applySearch(query, RECEIPT_SEARCH_COLUMNS, debouncedSearch)

      // kind + source_id are tiebreakers so pages stay stable.
      const { data, error, count } = await query
        .order('paid_at', { ascending: false })
        .order('kind', { ascending: true })
        .order('source_id', { ascending: true })
        .range(from, exact ? to : to + 1)

      if (cancelled) return

      if (error) throw error
      if (!Array.isArray(data) || (exact && (!Number.isSafeInteger(count) || count < 0))) {
        throw new Error('The receipt list response is incomplete.')
      }
      if (data.length === 0 && page > 0 && (!exact || count > 0)) {
        goToPage(exact ? pageCount(count) - 1 : page - 1)
        return
      } else {
        const result = interpretPage(data, count, page, exact)
        setPageError('')
        setRows(result.rows.map(mapFeedRow))
        setPageInfo({ total: result.total, minimum: result.minimum })
      }
      } catch (failure) {
        if (!cancelled) {
          setListError(`Could not load receipts: ${failure?.message || 'Connection failed.'}`)
          setRows([])
          setPageInfo({ total: 0, minimum: 0 })
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadRows()
    return () => { cancelled = true }
  }, [scopeKey, page, reloadTick])

  // Card totals for the period being viewed (the month, or the custom range) - computed by the database.
  const summaryRange = customRange
    ? { from: customRange.from || EARLIEST, to: customRange.to || LATEST }
    : monthRange(monthKey)
  const summaryLabel = customRange
    ? fromDate && toDate
      ? fromDate === toDate
        ? formatDateOnly(fromDate)
        : `${formatDateOnly(fromDate)} – ${formatDateOnly(toDate)}`
      : fromDate
        ? `from ${formatDateOnly(fromDate)}`
        : `up to ${formatDateOnly(toDate)}`
    : monthLabel(monthKey)

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    setSummaryError('')
    async function loadSummary() {
      try {
        const { data, error } = await supabase.rpc('receipts_period_summary', {
          p_from: summaryRange.from, p_to: summaryRange.to,
        })
        if (error) throw error
        const row = Array.isArray(data) ? data[0] : data
        if (!row || ['completed_count', 'service_count', 'voided_count', 'dues_collected', 'service_collected']
          .some((key) => row[key] == null || !Number.isFinite(Number(row[key])) || Number(row[key]) < 0)) {
          throw new Error('Receipt totals are incomplete.')
        }
        if (!cancelled) setSummary(row)
      } catch (failure) {
        if (!cancelled) setSummaryError(`Receipt totals are unavailable: ${failure?.message || 'Connection failed.'}`)
      }
    }
    loadSummary()
    return () => { cancelled = true }
  }, [summaryRange.from, summaryRange.to, reloadTick])

    // Voided receipts are not counted: the cards show active receipts only.
  const summaryTotals = summary
    ? {
        total: (Number(summary.completed_count) || 0) + (Number(summary.service_count) || 0),
        paymentCount: Number(summary.completed_count) || 0,
        serviceCount: Number(summary.service_count) || 0,
        voidedCount: Number(summary.voided_count) || 0,
        collected: (Number(summary.dues_collected) || 0) + (Number(summary.service_collected) || 0),
      }
    : null

  // Calendar dots: asked for one month at a time, only when the calendar shows it.
  const loadedMonthsRef = useRef(new Set())

  useEffect(() => {
    loadedMonthsRef.current = new Set()
    setActiveDays({})
  }, [reloadTick])

  async function loadActiveDays(year, month) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}` // month is 0-based
    if (loadedMonthsRef.current.has(key)) return
    loadedMonthsRef.current.add(key)
    try {
      const { data, error } = await supabase.rpc('receipt_active_days', {
        p_month: `${key}-01`,
        p_include_services: true,
      })
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Calendar response is incomplete.')
      setActiveDays((current) => ({ ...current, [key]: new Set(data) }))
    } catch {
      loadedMonthsRef.current.delete(key)
    }
  }

  const activeDateKeys = useMemo(() => {
    const keys = new Set()
    Object.values(activeDays).forEach((days) => days.forEach((day) => keys.add(day)))
    return keys
  }, [activeDays])

  // Open one receipt: fetch its full record (balances, notes, times) just now.
  async function openReceipt(receipt) {
    if (openingId) return
    setOpeningId(receipt.id)
    try {
      const table = receipt.type === 'service' ? 'service_transactions' : 'payments'
      const { data, error } = await supabase.from(table)
        .select('*').eq('id', receipt.sourceId).maybeSingle()
      if (error) throw error
      if (!data || String(data.id) !== String(receipt.sourceId)) {
        throw new Error('The requested receipt could not be verified.')
      }
      const payment = receipt.type === 'service' ? data : await loadPaymentReceipt(supabase, data)
      await recordReceiptActivity('Receipt Viewed', { kind: receipt.type, receiptNumber: data.receipt_number, recordId: data.id })
      setPageError('')
      setSelectedReceipt(receipt.type === 'service' ? mapServiceReceipt(data) : mapPaymentReceipt(payment))
    } catch (failure) {
      setPageError(`Could not open receipt ${receipt.receiptNumber}: ${failure?.message || 'Connection failed.'}`)
    } finally {
      setOpeningId('')
    }
  }

  function clearFilters() {
    setSearch('')
    setTypeFilter('all')
    setFromDate('')
    setToDate('')
    setMonthKey(currentManilaMonthKey())
  }

  function handleSelectCalendarDate(dateKey) {
    setFromDate(dateKey)
    setToDate(dateKey)
    calendar.hide()
  }

  const selectedSingleDateKey =
    fromDate && fromDate === toDate ? fromDate : ''

  return (
    <div className="official-receipts-page">
      <header className="official-receipts-header">
        <div className="official-header-heading">
          <span className="official-header-icon" aria-hidden="true"><ReceiptText size={28} strokeWidth={1.8} /></span>
          <div className="official-receipts-header-content">
            <p className="official-receipts-eyebrow">
              Finance Receipts Workspace
            </p>
  
            <h1>
              Official Receipts
            </h1>
  
            <p>
              Find, review, and reprint
              regular-payment and service-payment
              receipts.
            </p>
          </div>
        </div>

        <div
          className="official-receipts-header-actions"
          ref={calendarAnchorRef}
        >
          <button
            type="button"
            className="
              official-receipts-button
              official-receipts-secondary
            "
            onClick={() =>
              calendar.toggle()
            }
            aria-expanded={calendar.open}
          >
            <FileText size={17} />
            View by Date
          </button>

          <button
            type="button"
            className="
              official-receipts-button
              official-receipts-refresh
            "
            onClick={() => setReloadTick((tick) => tick + 1)}
            disabled={loading}
          >
            <RefreshCw size={17} />

            {loading
              ? 'Refreshing...'
              : 'Refresh Receipts'}
          </button>

          {calendar.mounted && (
            <div className={`official-calendar-animation ${calendar.visible ? 'is-visible' : ''}`}>
              <ReceiptCalendar
              selectedDateKey={selectedSingleDateKey}
              activeDateKeys={activeDateKeys}
              onSelectDate={handleSelectCalendarDate}
              onClose={calendar.hide}
              onViewMonthChange={loadActiveDays}
              />
            </div>
          )}
        </div>
      </header>

      <section
        className="official-receipts-summary"
        aria-label="Receipt summaries"
        aria-busy={loading || (!summary && !summaryError)}
      >
        <article>
          <div className="official-stat-top"><span className="official-stat-label">Total Receipts</span><span
            className="
              official-summary-icon
              official-summary-all
            "
          >
            <FileText size={20} />
          </span></div>
          <strong>
              {summaryTotals
                ? summaryTotals.total.toLocaleString(
                    'en-PH',
                  )
                : '—'}
            </strong>
          <p>
              {summaryLabel}
              {summaryTotals?.voidedCount > 0 && ` · ${summaryTotals.voidedCount} voided not counted`}
            </p>
          <div className="official-stat-footer"><span aria-hidden="true" />Non-voided receipt records</div>
        </article>

        <article>
          <div className="official-stat-top"><span className="official-stat-label">Regular Payments</span><span
            className="
              official-summary-icon
              official-summary-payment
            "
          >
            <CreditCard size={20} />
          </span></div>
          <strong>
              {summaryTotals
                ? summaryTotals.paymentCount.toLocaleString(
                    'en-PH',
                  )
                : '—'}
            </strong>
          <p>Dues and other payments</p>
          <div className="official-stat-footer"><span aria-hidden="true" />Homeowner payment receipts</div>
        </article>

        <article>
          <div className="official-stat-top"><span className="official-stat-label">Service Payments</span><span
            className="
              official-summary-icon
              official-summary-service
            "
          >
            <FileText size={20} />
          </span></div>
          <strong>
              {summaryTotals
                ? summaryTotals.serviceCount.toLocaleString(
                    'en-PH',
                  )
                : '—'}
            </strong>
          <p>Amenity transactions</p>
          <div className="official-stat-footer"><span aria-hidden="true" />Service payment receipts</div>
        </article>

        <article>
          <div className="official-stat-top"><span className="official-stat-label">Total Collected</span><span
            className="
              official-summary-icon
              official-summary-total
            "
          >
            <CreditCard size={20} />
          </span></div>
          <strong className="official-summary-money">
              {summaryTotals
                ? peso.format(summaryTotals.collected)
                : '—'}
            </strong>
          <p>Excludes voided receipts</p>
          <div className="official-stat-footer"><span aria-hidden="true" />Homeowner and service payments</div>
        </article>
      </section>

      {pageError && (
        <p className="official-receipts-error">
          {pageError}
        </p>
      )}
      {summaryError && <p className="official-receipts-error" role="alert">{summaryError}</p>}

      <section className="official-receipts-records">
        <div className="official-records-heading">
          <div>
            <h2>Receipt history</h2>

            <p>
              {loading
                ? <Skeleton variant="rect" width="180px" height="1em" />
                : scopeKind === 'month'
                  ? `${countLabel(pageInfo, 'receipt', 'receipts')} in ${monthLabel(monthKey)} — search to look through every month`
                  : scopeKind === 'search'
                    ? `${countLabel(pageInfo, 'receipt', 'receipts')} found across all months`
                    : `${countLabel(pageInfo, 'receipt', 'receipts')} in the selected dates`}
            </p>
          </div>

          {scopeKind === 'month' && (
            <MonthSwitcher monthKey={monthKey} onChange={setMonthKey} disabled={loading} />
          )}
          {scopeKind === 'search' && (
            <span className="scope-note">Searching all months</span>
          )}
        </div>

        <div className="official-filter-toolbar">
          <label className="official-search-field"><span>Search</span><div className="official-search-control"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search official receipts" placeholder="Receipt no., homeowner, property, or purpose" value={search} onChange={event => setSearch(event.target.value)} /></div></label>
          <div className="official-filter-row">
            <div className="official-receipt-tabs" role="group" aria-label="Receipt type">
              {[
                ['all', 'All receipts'], ['payment', 'Regular payments'], ['service', 'Service payments'],
              ].map(([value, label]) => <button key={value} type="button" aria-pressed={typeFilter === value} onClick={() => setTypeFilter(value)}>{label}</button>)}
            </div>
            <div className="official-date-fields">
              <label><span>From date</span><DateField ariaLabel="From date" value={fromDate} max={toDate || undefined} onChange={setFromDate} /></label>
              <label><span>To date</span><DateField ariaLabel="To date" value={toDate} min={fromDate || undefined} onChange={setToDate} /></label>
              <button type="button" className="official-clear-button" onClick={clearFilters} disabled={!filtersActive && monthKey === currentManilaMonthKey()}>Clear Filters</button>
            </div>
          </div>
          <p className="official-search-hint">Search by receipt number, homeowner, property, payment method, or reference number.</p>
        </div>

        {invalidDateRange && (
          <p className="official-filter-error">
            The “From date” must be earlier than
            or the same as the “To date.”
          </p>
        )}

        <div className="official-receipts-table-wrap">
          <table className="official-receipts-table">
            <colgroup>{[12, 12, 10, 13, 17, 10, 7, 8, 11].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead>
              <tr>
                <th>Receipt No.</th>
                <th>Date Issued</th>
                <th>Type</th>
                <th>Homeowner</th>
                <th>Payment Details</th>
                <th>Amount</th>
                <th>Method</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan="9"
                    className="official-receipts-empty"
                  >
                    <div aria-busy="true"><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><span className="skeleton-region-status" role="status">Loading</span></div>
                  </td>
                </tr>
              ) : invalidDateRange ? (
                <tr>
                  <td
                    colSpan="9"
                    className="official-receipts-empty"
                  >
                    Fix the date range above to view receipts.
                  </td>
                </tr>
              ) : listError ? (
                <tr>
                  <td colSpan="9" className="official-receipts-empty" role="alert">
                    Receipt history could not be verified. Refresh Receipts to retry.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan="9"
                    className="official-receipts-empty"
                  >
                    {scopeKind === 'month'
                      ? `No receipts were issued in ${monthLabel(monthKey)}. Use the arrows to view another month, or search to look through every month.`
                      : 'No receipts match the selected search and filters.'}
                  </td>
                </tr>
              ) : (
                rows.map(
                  (receipt) => (
                    <tr key={receipt.id} className={receipt.isVoided ? 'official-row-voided' : ''}>
                      <td data-label="Receipt no.">
                        <strong>
                          {receipt.receiptNumber}
                        </strong>
                      </td>

                      <td data-label="Date issued">
                        {formatDateTime(
                          receipt.issuedAt,
                          organization.dateFormat,
                        )}
                      </td>

                      <td data-label="Type">
                        <span
                          className={`official-type-badge ${receipt.type}`}
                        >
                          {receipt.typeLabel}
                        </span>
                      </td>

                      <td data-label="Homeowner">
                        <strong>
                          {receipt.payer}
                        </strong>

                        <small>
                          {receipt.property}
                        </small>
                      </td>

                      <td data-label="Payment details">
                        {receipt.description}
                      </td>

                      <td data-label="Amount" className={`official-amount ${receipt.isVoided ? 'official-amount-voided' : ''}`}>
                        {peso.format(
                          receipt.amount,
                        )}
                      </td>

                      <td data-label="Method">
                        {receipt.method}
                      </td>

                      <td data-label="Status" className="official-status-cell">
                        <span className={`official-receipt-status ${receipt.isVoided ? 'is-voided' : 'is-active'}`}>
                          {receipt.isVoided ? 'Voided' : 'Active'}
                        </span>
                      </td>
                      <td data-label="Actions" className="official-table-action-cell"><div className="official-table-action-buttons">
                        <button
                          type="button"
                          className="official-view-button"
                          onClick={() =>
                            openReceipt(receipt)
                          }
                          disabled={openingId === receipt.id}
                        >
                          <Eye size={16} />
                          {openingId === receipt.id ? 'Opening…' : 'View'}
                        </button>
                        {canVoidReceipt(receipt.type) && !receipt.isVoided && (
                          <button type="button" className="official-void-button"
                            disabled={Boolean(openingId)}
                            onClick={() => { setSelectedReceipt(null); setVoidTarget(receipt) }}>
                            Void
                          </button>
                        )}
                      </div></td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>

        <Pager page={page} total={pageInfo.total} onPageChange={goToPage} disabled={loading || Boolean(listError) || invalidDateRange} />
      </section>

      {selectedReceipt && (() => {
        const receiptModel = buildReceiptModel(selectedReceipt.type, selectedReceipt.raw, organization, { settledAmount: settlement.amount })
        return (
          <ReceiptDialog
            model={receiptModel}
            verificationLoading={settlement.loading}
            verificationError={settlement.error}
            onClose={() => setSelectedReceipt(null)}
            onPrint={(setup) => printReceipt(receiptModel, setPopupNotice, setup)}
          >
            {canVoidReceipt(selectedReceipt.type) && !receiptModel.voided && (
              <button type="button" className="rcpt-btn rcpt-btn-danger"
                onClick={() => { setVoidTarget(selectedReceipt); setSelectedReceipt(null) }}>
                Void receipt
              </button>
            )}
          </ReceiptDialog>
        )
      })()}

      {voidTarget && (voidTarget.type === 'service' ? (
        <ServiceVoidDialog receipt={voidTarget.raw || { id: voidTarget.sourceId, receipt_number: voidTarget.receiptNumber }}
          onClose={() => setVoidTarget(null)}
          onVoided={() => { setVoidTarget(null); setReloadTick((tick) => tick + 1) }} />
      ) : role === 'secretary' && (
        <OfficialRegularVoidDialog
          receipt={voidTarget.raw || { id: voidTarget.sourceId, receipt_number: voidTarget.receiptNumber, homeowner_name: voidTarget.payer }}
          role={role} onClose={() => setVoidTarget(null)}
          onVoided={() => { setVoidTarget(null); setReloadTick((tick) => tick + 1) }} />
      ))}

      <ActionDialog
        open={!!popupNotice}
        title="Pop-up Blocked"
        message={popupNotice}
        onConfirm={() => setPopupNotice('')}
      />
    </div>
  )
}