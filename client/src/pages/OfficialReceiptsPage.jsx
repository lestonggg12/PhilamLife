import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { useOrganization } from '../context/OrganizationContext'
import { formatDate as formatDateValue } from '../config/organization'
import ActionDialog from '../components/ActionDialog'
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

const escapePrintText = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

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

function receiptRows(receipt, dateFormat) {
  if (receipt.type === 'service') {
    const transaction = receipt.raw

    const rows = [
      ['Received from', receipt.payer],
      ['Property', receipt.property],
      ['Service', receipt.description],
      [
        'Service date',
        formatDateOnly(transaction.service_date),
      ],
    ]

    if (transaction.start_time) {
      rows.push([
        'Start time',
        String(transaction.start_time).slice(0, 5),
      ])
    }

    rows.push(
      ['Quantity', transaction.quantity ?? 1],
      [
        'Amount due',
        peso.format(
          Number(transaction.amount_due) || 0,
        ),
      ],
      ['Amount paid', peso.format(receipt.amount)],
      [
        'Payment status',
        transaction.payment_status === 'partial'
          ? 'Partial payment'
          : 'Paid',
      ],
      ['Payment method', receipt.method],
    )

    if (receipt.referenceNumber) {
      rows.push([
        'Reference no.',
        receipt.referenceNumber,
      ])
    }

    rows.push(
      [
        'Date issued',
        formatDateTime(receipt.issuedAt, dateFormat),
      ],
      ['Processed by', receipt.recordedBy],
    )

    if (transaction.notes) {
      rows.push(['Notes', transaction.notes])
    }

    return rows
  }

  const payment = receipt.raw

  const rows = [
    ['Received from', receipt.payer],
    ['Property', receipt.property],
    ['Payment for', receipt.description],
    [
      'Previous balance',
      peso.format(
        Number(payment.previous_balance) || 0,
      ),
    ],
    ['Amount paid', peso.format(receipt.amount)],
    [
      'Remaining balance',
      peso.format(
        Number(payment.remaining_balance) || 0,
      ),
    ],
    ['Payment method', receipt.method],
  ]

  if (receipt.referenceNumber) {
    rows.push([
      'Reference no.',
      receipt.referenceNumber,
    ])
  }

  rows.push(
    [
      'Date issued',
      formatDateTime(receipt.issuedAt, dateFormat),
    ],
    ['Recorded by', receipt.recordedBy],
  )

  if (payment.note) {
    rows.push(['Note', payment.note])
  }

  return rows
}

function printOfficialReceipt(receipt, associationName, onPopupBlocked, dateFormat) {
  const printWindow = window.open(
    '',
    '_blank',
    'width=900,height=700',
  )

  if (!printWindow) {
    onPopupBlocked?.('Please allow pop-ups to print this receipt.')
    return
  }

  const rows = receiptRows(receipt, dateFormat)
    .map(
      ([label, value]) => `
        <div class="receipt-row${
          label === 'Amount paid'
            ? ' amount-paid'
            : ''
        }">
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

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />

        <title>
          ${escapePrintText(receipt.receiptNumber)}
          -
          ${escapePrintText(receipt.title)}
        </title>

        <style>
          @page {
            size: A4 portrait;
            margin: 16mm;
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            background: #ffffff;
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
            letter-spacing: 0.06em;
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

          .receipt-details {
            border-top: 1px solid #dce8f0;
          }

          .receipt-row {
            display: flex;
            justify-content: space-between;
            gap: 24px;
            padding: 11px 0;
            border-bottom: 1px solid #e7eff4;
          }

          .receipt-row span {
            color: #5d7d98;
          }

          .receipt-row strong {
            color: #071e30;
            text-align: right;
            overflow-wrap: anywhere;
          }

          .receipt-row.amount-paid strong {
            color: #1464a0;
            font-size: 17px;
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

          <p class="association">
            ${escapePrintText(associationName)}
          </p>

          <h1>
            ${escapePrintText(receipt.title)}
          </h1>

          <strong class="number">
            ${escapePrintText(receipt.receiptNumber)}
          </strong>

          <section class="receipt-details">
            ${rows}
          </section>

          <p class="note">
            This computer-generated receipt is based
            on a permanent transaction saved in the
            ${escapePrintText(associationName)}
            system.
          </p>
        </main>
      </body>
    </html>
  `)

  printWindow.document.close()
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

export default function OfficialReceiptsPage() {
  const { organization } = useOrganization()
  // One page (50) of receipts at a time, read from the database.
  const [rows, setRows] = useState([])
  const [pageInfo, setPageInfo] = useState({ total: 0, minimum: 0 })
  const [monthKey, setMonthKey] = useState(() => currentManilaMonthKey())
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [summary, setSummary] = useState(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [activeDays, setActiveDays] = useState({})
  const [openingId, setOpeningId] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [popupNotice, setPopupNotice] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] =
    useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedReceipt, setSelectedReceipt] =
    useState(null)
  const calendar = useAnimatedPopover()
  const calendarAnchorRef = useRef(null)

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
      setRows([])
      setPageInfo({ total: 0, minimum: 0 })
      setLoading(false)
      return undefined
    }

    let cancelled = false

    async function loadRows() {
      setLoading(true)
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

      if (error) {
        setPageError(`Could not load receipts: ${error.message}`)
        setRows([])
        setPageInfo({ total: 0, minimum: 0 })
      } else if ((data || []).length === 0 && page > 0 && (!exact || (count || 0) > 0)) {
        goToPage(exact ? pageCount(count) - 1 : page - 1)
        return
      } else {
        const result = interpretPage(data, count, page, exact)
        setPageError('')
        setRows(result.rows.map(mapFeedRow))
        setPageInfo({ total: result.total, minimum: result.minimum })
      }
      setLoading(false)
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

    supabase
      .rpc('receipts_period_summary', { p_from: summaryRange.from, p_to: summaryRange.to })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('Could not load receipt totals:', error.message)
          return
        }
        setSummary(Array.isArray(data) ? data[0] || null : data)
      })

    return () => { cancelled = true }
  }, [summaryRange.from, summaryRange.to, reloadTick])

  const summaryTotals = summary
    ? {
        total: (Number(summary.payment_count) || 0) + (Number(summary.service_count) || 0),
        paymentCount: Number(summary.payment_count) || 0,
        serviceCount: Number(summary.service_count) || 0,
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

    const { data, error } = await supabase.rpc('receipt_active_days', {
      p_month: `${key}-01`,
      p_include_services: true,
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

  // Open one receipt: fetch its full record (balances, notes, times) just now.
  async function openReceipt(receipt) {
    if (openingId) return
    setOpeningId(receipt.id)

    const table = receipt.type === 'service' ? 'service_transactions' : 'payments'
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('id', receipt.sourceId)
      .maybeSingle()

    setOpeningId('')

    if (error || !data) {
      setPageError(`Could not open receipt ${receipt.receiptNumber}: ${error?.message || 'it no longer exists.'}`)
      return
    }

    setSelectedReceipt(
      receipt.type === 'service' ? mapServiceReceipt(data) : mapPaymentReceipt(data),
    )
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
        <div className="official-receipts-header-content">
          <p className="official-receipts-eyebrow">
            Secretary workspace
          </p>

          <h1>
            Payment Receipts Management
          </h1>

          <p>
            Find, review, and reprint
            regular-payment and service-payment
            receipts.
          </p>
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

      {pageError && (
        <p className="official-receipts-error">
          {pageError}
        </p>
      )}

      <section
        className="official-receipts-summary"
        aria-label="Receipt summaries"
      >
        <article>
          <span
            className="
              official-summary-icon
              official-summary-all
            "
          >
            <FileText size={20} />
          </span>

          <div>
            <small>Total Receipts</small>

            <strong>
              {summaryTotals
                ? summaryTotals.total.toLocaleString(
                    'en-PH',
                  )
                : '—'}
            </strong>

            <p>{summaryLabel}</p>
          </div>
        </article>

        <article>
          <span
            className="
              official-summary-icon
              official-summary-payment
            "
          >
            <CreditCard size={20} />
          </span>

          <div>
            <small>Regular Payments</small>

            <strong>
              {summaryTotals
                ? summaryTotals.paymentCount.toLocaleString(
                    'en-PH',
                  )
                : '—'}
            </strong>

            <p>Dues and other payments</p>
          </div>
        </article>

        <article>
          <span
            className="
              official-summary-icon
              official-summary-service
            "
          >
            <FileText size={20} />
          </span>

          <div>
            <small>Service Payments</small>

            <strong>
              {summaryTotals
                ? summaryTotals.serviceCount.toLocaleString(
                    'en-PH',
                  )
                : '—'}
            </strong>

            <p>Amenity transactions</p>
          </div>
        </article>

        <article>
          <span
            className="
              official-summary-icon
              official-summary-total
            "
          >
            <CreditCard size={20} />
          </span>

          <div>
            <small>Total Collected</small>

            <strong className="official-summary-money">
              {summaryTotals
                ? peso.format(summaryTotals.collected)
                : '—'}
            </strong>

            <p>Excludes voided receipts</p>
          </div>
        </article>
      </section>

      <section className="official-receipts-records">
        <div className="official-records-heading">
          <div>
            <h2>Receipt Records</h2>

            <p>
              {loading
                ? 'Loading saved transactions...'
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

        <div className="official-receipts-filters">
          <label className="official-search-field">
            <span>Search</span>
            <div className="official-search-control">
              <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="
                Receipt no., homeowner,
                property, or purpose
              "
            />
            </div>
          </label>

          <label>
            <span>Receipt type</span>

            <select
              value={typeFilter}
              onChange={(event) =>
                setTypeFilter(event.target.value)
              }
            >
              <option value="all">
                All receipt types
              </option>

              <option value="payment">
                Regular payments
              </option>

              <option value="service">
                Service payments
              </option>
            </select>
          </label>

          <label>
            <span>From date</span>

            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) =>
                setFromDate(event.target.value)
              }
            />
          </label>

          <label>
            <span>To date</span>

            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) =>
                setToDate(event.target.value)
              }
            />
          </label>

          <button
            type="button"
            className="official-clear-button"
            onClick={clearFilters}
            disabled={!filtersActive && monthKey === currentManilaMonthKey()}
          >
            Clear Filters
          </button>
        </div>

        {invalidDateRange && (
          <p className="official-filter-error">
            The “From date” must be earlier than
            or the same as the “To date.”
          </p>
        )}

        <div className="official-receipts-table-wrap">
          <table className="official-receipts-table">
            <thead>
              <tr>
                <th>Receipt No.</th>
                <th>Date Issued</th>
                <th>Type</th>
                <th>Homeowner</th>
                <th>Payment Details</th>
                <th>Amount</th>
                <th>Method</th>
                <th aria-label="Actions" />
              </tr>
            </thead>

            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan="8"
                    className="official-receipts-empty"
                  >
                    Loading payment receipts...
                  </td>
                </tr>
              ) : invalidDateRange ? (
                <tr>
                  <td
                    colSpan="8"
                    className="official-receipts-empty"
                  >
                    Fix the date range above to view receipts.
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan="8"
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
                      <td>
                        <strong>
                          {receipt.receiptNumber}
                        </strong>
                      </td>

                      <td>
                        {formatDateTime(
                          receipt.issuedAt,
                          organization.dateFormat,
                        )}
                      </td>

                      <td>
                        <span
                          className={`official-type-badge ${receipt.type}`}
                        >
                          {receipt.typeLabel}
                        </span>
                        {receipt.isVoided && (
                          <span className="official-voided-badge">Voided</span>
                        )}
                      </td>

                      <td>
                        <strong>
                          {receipt.payer}
                        </strong>

                        <small>
                          {receipt.property}
                        </small>
                      </td>

                      <td>
                        {receipt.description}
                      </td>

                      <td className={`official-amount ${receipt.isVoided ? 'official-amount-voided' : ''}`}>
                        {peso.format(
                          receipt.amount,
                        )}
                      </td>

                      <td>
                        {receipt.method}
                      </td>

                      <td>
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
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>

        <Pager page={page} total={pageInfo.total} onPageChange={goToPage} disabled={loading} />
      </section>

      {selectedReceipt && (
        <div
          className="official-receipt-backdrop"
          role="presentation"
          onMouseDown={() =>
            setSelectedReceipt(null)
          }
        >
          <article
            className="official-receipt-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="official-receipt-title"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="official-receipt-modal-heading">
              <div>
                <p>
                  {organization.associationName}
                </p>

                <h2 id="official-receipt-title">
                  {selectedReceipt.title}
                </h2>
              </div>

              <button
                type="button"
                aria-label="Close receipt"
                onClick={() =>
                  setSelectedReceipt(null)
                }
              >
                <X size={19} />
              </button>
            </div>

            <strong className="official-receipt-number">
              {selectedReceipt.receiptNumber}
            </strong>

            <dl className="official-receipt-details">
              {receiptRows(selectedReceipt, organization.dateFormat).map(
                ([label, value]) => (
                  <div
                    key={label}
                    className={
                      label === 'Amount paid'
                        ? 'official-paid-row'
                        : ''
                    }
                  >
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ),
              )}
            </dl>

            <p className="official-receipt-note">
              This is a permanent transaction
              record. Viewing or printing it does
              not change the saved payment.
            </p>

            <div className="official-receipt-actions">
              <button
                type="button"
                className="
                  official-receipts-button
                  official-receipts-secondary
                "
                onClick={() =>
                  setSelectedReceipt(null)
                }
              >
                Close
              </button>

              <button
                type="button"
                className="
                  official-receipts-button
                  official-receipts-primary
                "
                onClick={() =>
                  printOfficialReceipt(
                    selectedReceipt,
                    organization.associationName,
                    setPopupNotice,
                    organization.dateFormat,
                  )
                }
              >
                <Printer size={17} />
                Print / Save as PDF
              </button>
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