import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  CreditCard,
  Eye,
  FileText,
  Printer,
  RefreshCw,
  X,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'
import './OfficialReceiptsPage.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
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

function formatDateTime(value) {
  if (!value) return 'Date unavailable'

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime())
    ? 'Date unavailable'
    : dateTime.format(parsed)
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

function receiptRows(receipt) {
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
        formatDateTime(receipt.issuedAt),
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
      formatDateTime(receipt.issuedAt),
    ],
    ['Recorded by', receipt.recordedBy],
  )

  if (payment.note) {
    rows.push(['Note', payment.note])
  }

  return rows
}

function printOfficialReceipt(receipt, associationName, onPopupBlocked) {
  const printWindow = window.open(
    '',
    '_blank',
    'width=900,height=700',
  )

  if (!printWindow) {
    onPopupBlocked?.('Please allow pop-ups to print this receipt.')
    return
  }

  const rows = receiptRows(receipt)
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
  const [receipts, setReceipts] = useState([])
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
  const [calendarOpen, setCalendarOpen] =
    useState(false)
  const calendarAnchorRef = useRef(null)

  useEffect(() => {
    loadReceipts()
  }, [])

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
  }, [calendarOpen])

  async function loadReceipts() {
    setLoading(true)
    setPageError('')

    const [
      paymentResult,
      serviceResult,
    ] = await Promise.all([
      supabase
        .from('payments')
        .select('*')
        .order('paid_at', {
          ascending: false,
        }),

      supabase
        .from('service_transactions')
        .select('*')
        .order('paid_at', {
          ascending: false,
        }),
    ])

    const errors = []
    const combined = []

    if (paymentResult.error) {
      errors.push(
        `Regular receipts: ${paymentResult.error.message}`,
      )
    } else {
      combined.push(
        ...(paymentResult.data || []).map(
          mapPaymentReceipt,
        ),
      )
    }

    if (serviceResult.error) {
      errors.push(
        `Service receipts: ${serviceResult.error.message}`,
      )
    } else {
      combined.push(
        ...(serviceResult.data || []).map(
          mapServiceReceipt,
        ),
      )
    }

    combined.sort((left, right) => {
      const leftTime =
        new Date(left.issuedAt).getTime() || 0

      const rightTime =
        new Date(right.issuedAt).getTime() || 0

      return rightTime - leftTime
    })

    setReceipts(combined)

    setPageError(
      errors.length > 0
        ? `Some receipts could not be loaded. ${errors.join(
            ' ',
          )}`
        : '',
    )

    setLoading(false)
  }

  const invalidDateRange = Boolean(
    fromDate &&
      toDate &&
      fromDate > toDate,
  )

  const filteredReceipts = useMemo(() => {
    if (invalidDateRange) return []

    const query = normalize(search)

    return receipts.filter((receipt) => {
      const matchesSearch =
        !query ||
        receipt.searchText.includes(query)

      const matchesType =
        typeFilter === 'all' ||
        receipt.type === typeFilter

      const matchesFrom =
        !fromDate ||
        receipt.issuedDateKey >= fromDate

      const matchesTo =
        !toDate ||
        receipt.issuedDateKey <= toDate

      return (
        matchesSearch &&
        matchesType &&
        matchesFrom &&
        matchesTo
      )
    })
  }, [
    fromDate,
    invalidDateRange,
    receipts,
    search,
    toDate,
    typeFilter,
  ])

  const activeDateKeys = useMemo(() => {
    const keys = new Set()

    receipts.forEach((receipt) => {
      if (receipt.issuedDateKey) {
        keys.add(receipt.issuedDateKey)
      }
    })

    return keys
  }, [receipts])

  const summary = useMemo(() => {
    const paymentReceipts = receipts.filter(
      (receipt) => receipt.type === 'payment',
    )

    const serviceReceipts = receipts.filter(
      (receipt) => receipt.type === 'service',
    )

    return {
      total: receipts.length,
      paymentCount: paymentReceipts.length,
      serviceCount: serviceReceipts.length,
      collected: receipts.reduce(
        (sum, receipt) =>
          receipt.isVoided ? sum : sum + receipt.amount,
        0,
      ),
    }
  }, [receipts])

  function clearFilters() {
    setSearch('')
    setTypeFilter('all')
    setFromDate('')
    setToDate('')
  }

  function handleSelectCalendarDate(dateKey) {
    setFromDate(dateKey)
    setToDate(dateKey)
    setCalendarOpen(false)
  }

  const filtersActive = Boolean(
    search ||
      typeFilter !== 'all' ||
      fromDate ||
      toDate,
  )

  const selectedSingleDateKey =
    fromDate && fromDate === toDate ? fromDate : ''

  return (
    <div className="official-receipts-page">
      <header className="official-receipts-header">
        <div>
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
              setCalendarOpen((open) => !open)
            }
            aria-expanded={calendarOpen}
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
            onClick={loadReceipts}
            disabled={loading}
          >
            <RefreshCw size={17} />

            {loading
              ? 'Refreshing...'
              : 'Refresh Receipts'}
          </button>

          {calendarOpen && (
            <ReceiptCalendar
              selectedDateKey={selectedSingleDateKey}
              activeDateKeys={activeDateKeys}
              onSelectDate={handleSelectCalendarDate}
              onClose={() => setCalendarOpen(false)}
            />
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
              {loading
                ? '—'
                : summary.total.toLocaleString(
                    'en-PH',
                  )}
            </strong>

            <p>All permanent records</p>
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
              {loading
                ? '—'
                : summary.paymentCount.toLocaleString(
                    'en-PH',
                  )}
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
              {loading
                ? '—'
                : summary.serviceCount.toLocaleString(
                    'en-PH',
                  )}
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
              {loading
                ? '—'
                : peso.format(summary.collected)}
            </strong>

            <p>Across all saved receipts</p>
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
                : `${filteredReceipts.length.toLocaleString(
                    'en-PH',
                  )} of ${receipts.length.toLocaleString(
                    'en-PH',
                  )} receipts shown`}
            </p>
          </div>
        </div>

        <div className="official-receipts-filters">
          <label className="official-search-field">
            <span>Search</span>

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
            disabled={!filtersActive}
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
              {loading ? (
                <tr>
                  <td
                    colSpan="8"
                    className="official-receipts-empty"
                  >
                    Loading payment receipts...
                  </td>
                </tr>
              ) : filteredReceipts.length === 0 ? (
                <tr>
                  <td
                    colSpan="8"
                    className="official-receipts-empty"
                  >
                    {receipts.length === 0
                      ? 'No payment receipts have been recorded yet.'
                      : 'No receipts match the selected search and filters.'}
                  </td>
                </tr>
              ) : (
                filteredReceipts.map(
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
                            setSelectedReceipt(
                              receipt,
                            )
                          }
                        >
                          <Eye size={16} />
                          View
                        </button>
                      </td>
                    </tr>
                  ),
                )
              )}
            </tbody>
          </table>
        </div>
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
              {receiptRows(selectedReceipt).map(
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