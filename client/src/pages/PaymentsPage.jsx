import { notifySuccess } from '../lib/actionFeedback'
import { financialSubmissionIntent, assertFinancialSubmissionMatches, requireUnchangedFinancialAttempt } from '../lib/financialSubmissionIntegrity'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { findActivePaymentLot, paymentLotFields } from '../lib/paymentLotPrefill'
import { supabase } from '../lib/supabaseClient'
import ReceiptNoteAmendmentDialog from '../components/ReceiptNoteAmendmentDialog'
import { fetchAll } from '../lib/fetchAll'
import { readPropertyBalance } from '../lib/paymentBalanceRefresh'
import { loadOpenCharges } from '../lib/openChargeSearch'
import { paymentSetupErrors } from '../lib/paymentSetup'
import { isValidManualChargeDueDate } from '../lib/manualChargeDueDate'
import { advanceCreditDetails, advanceCreditNote } from '../lib/advanceCredit'
import { PAYMENT_PURPOSES, CHARGE_TYPES, isBalanceReducingPurpose, paymentAdvanceConfirmation } from '../lib/paymentPurposes'
import { manualDiscountSettlesFullBalance } from '../lib/manualDiscountEligibility'
import { useOrganization } from '../context/OrganizationContext'
import ActionDialog from '../components/ActionDialog'
import BalanceBreakdown from '../components/BalanceBreakdown'
import Select from '../components/Select'
import DateField from '../components/DateField'
import { ReceiptDialog } from '../components/ReceiptSheet'
import { buildReceiptModel } from '../lib/receiptModel'
import { printReceipt } from '../lib/printReceipt'
import './PaymentsPage.css'
import useAnimatedPopover from '../hooks/useAnimatedPopover'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { Pager } from '../components/PagerControls'
import Skeleton from '../components/skeleton/Skeleton'
import {
  applySearch,
  applyTimeRange,
  countLabel,
  dateSpanRange,
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


const EMPTY_FORM = {
  propertyId: '',
  homeownerName: '',
  blockName: '',
  lotNumber: '',
  paymentPurpose: '',
  specificChargeId: '',
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
  dueDate: '',
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

/* ---------- Date range picker (quick presets + range calendar) ---------- */
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_FORMAT = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' })

// Pure calendar math on 'YYYY-MM-DD' keys, so the Manila date never shifts with the browser timezone.
const toDate = (key) => new Date(`${key}T00:00:00Z`)
const toKey = (date) => date.toISOString().slice(0, 10)
const addDays = (key, days) => { const date = toDate(key); date.setUTCDate(date.getUTCDate() + days); return toKey(date) }
const monthStart = (key) => `${key.slice(0, 7)}-01`
const monthEnd = (key) => { const date = toDate(monthStart(key)); date.setUTCMonth(date.getUTCMonth() + 1, 0); return toKey(date) }
const shiftMonth = (key, offset) => { const date = toDate(monthStart(key)); date.setUTCMonth(date.getUTCMonth() + offset); return toKey(date) }

function paymentPresets(today) {
  const lastMonthEnd = addDays(monthStart(today), -1)
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { id: '7d', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { id: '30d', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { id: 'month', label: 'This month', from: monthStart(today), to: today },
    { id: 'lastmonth', label: 'Last month', from: monthStart(lastMonthEnd), to: monthEnd(lastMonthEnd) },
    { id: 'year', label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: today },
    { id: 'lastyear', label: 'Last year', from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: `${Number(today.slice(0, 4)) - 1}-12-31` },
    { id: 'all', label: 'All time', from: '2000-01-01', to: today },
  ]
}

function monthCells(cursor) {
  const first = toDate(monthStart(cursor))
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first)
    date.setUTCDate(1 - first.getUTCDay() + index)
    const key = toKey(date)
    return { key, day: date.getUTCDate(), outside: key.slice(0, 7) !== cursor.slice(0, 7) }
  })
}

/**
 * Date-range picker body: quick presets on the left, a range calendar on the right.
 * The page owns the open/close animation; this component only reports a choice.
 */
function PaymentDateRange({
  from, to, preset, todayKey, activeDateKeys, onViewMonthChange, onApply, onCancel, formatLabel,
}) {
  const presets = useMemo(() => paymentPresets(todayKey), [todayKey])
  const [cursor, setCursor] = useState(() => monthStart(to > todayKey ? todayKey : to))
  const [draft, setDraft] = useState({ from, to, preset })
  const [selectRange, setSelectRange] = useState(false)

  // Ask the page for just this month's "has payments" dots.
  useEffect(() => {
    if (onViewMonthChange) onViewMonthChange(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)) - 1)
  }, [cursor])

  const picking = draft.to === null
  const low = picking ? draft.from : draft.from <= draft.to ? draft.from : draft.to
  const high = picking ? draft.from : draft.from <= draft.to ? draft.to : draft.from
  const atCurrentMonth = cursor.slice(0, 7) >= todayKey.slice(0, 7)

  function pickCell(key) {
    // A calendar day selects that day immediately. Range selection is opt-in.
    if (!selectRange) {
      onApply(key, key, 'custom')
    } else if (picking) {
      const [start, end] = key < draft.from ? [key, draft.from] : [draft.from, key]
      setDraft({ from: start, to: end, preset: 'custom' })
    } else {
      setDraft({ from: key, to: null, preset: 'custom' })
    }
  }

  const summary = selectRange
    ? (picking ? 'Pick an end date' : formatLabel(low, high, draft.preset))
    : 'Click any day to view its receipts'

  return (
    <div className="payments-range" role="dialog" aria-label="Choose payment dates">
      <div className="payments-range-presets">
        <h3>Quick select</h3>
        {presets.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={draft.preset === item.id}
            onClick={() => onApply(item.from, item.to, item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="payments-range-calendar">
        <div className="payments-range-nav">
          <button type="button" aria-label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</button>
          <strong>{MONTH_FORMAT.format(toDate(cursor))}</strong>
          <button type="button" aria-label="Next month" disabled={atCurrentMonth} onClick={() => setCursor(shiftMonth(cursor, 1))}>›</button>
        </div>

        <div className="payments-range-weekdays" aria-hidden="true">
          {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
        </div>

        <div className="payments-range-grid">
          {monthCells(cursor).map((cell) => {
            const edge = cell.key === low || cell.key === high
            const classes = [
              cell.outside ? 'is-outside' : '',
              cell.key >= low && cell.key <= high ? 'is-in-range' : '',
              edge ? 'is-edge' : '',
              cell.key === todayKey ? 'is-today' : '',
              activeDateKeys?.has(cell.key) ? 'has-payments' : '',
            ].filter(Boolean).join(' ')
            return (
              <button
                key={cell.key}
                type="button"
                className={classes}
                disabled={cell.key > todayKey}
                aria-pressed={edge}
                aria-label={cell.key}
                onClick={() => pickCell(cell.key)}
              >
                {cell.day}
              </button>
            )
          })}
        </div>

        <div className="payments-range-legend">
          <span><i /> Has payments</span>
          <label className="payments-range-mode">
            <input
              type="checkbox"
              checked={selectRange}
              onChange={(event) => {
                setSelectRange(event.target.checked)
                setDraft({ from, to, preset })
              }}
            />
            Select a date range
          </label>
        </div>
      </div>

      <div className="payments-range-foot">
        <span>{summary}</span>
        <div>
          <button type="button" className="payments-secondary" onClick={onCancel}>Close</button>
          {selectRange && (
            <button
              type="button"
              className="payments-primary"
              disabled={picking}
              onClick={() => onApply(low, high, 'custom')}
            >
              Apply range
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Payment details pop-up (opens when a row is clicked) ---------- */
function PaymentDetailDialog({ payment, formatDate, canVoid, onClose, onVoid, onReceipt, onAmend }) {
  const dialogRef = useRef(null)
  const isVoided = payment.status === 'Voided'
  const amount = peso.format(Number(payment.amount_paid ?? payment.amount) || 0)

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])

  function handleKeys(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'Tab') {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled)')]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const details = [
    ['Receipt', payment.receipt_number],
    ['Recorded', formatDate(payment.paid_at, { withTime: true })],
    ['Homeowner', payment.homeowner_name],
    ['Property', `${payment.block_name} · Lot ${payment.lot_number}`],
    ['Details', payment.coverage_period, true],
    ['Method', payment.payment_method],
    ['Receipt note', payment.note],
  ]

  return (
    <div className="payments-overlay advance-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="advance-dialog payment-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-detail-title"
        tabIndex={-1}
        onKeyDown={handleKeys}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="void-head">
          <div className="advance-icon payment-detail-icon" aria-hidden="true">₱</div>
          <div>
            <h2 id="payment-detail-title">Payment {payment.receipt_number}</h2>
            <p>
              <span className={isVoided ? 'payments-status-voided' : 'payments-status-completed'}>
                {isVoided ? 'Voided' : 'Completed'}
              </span>
            </p>
          </div>
          <button type="button" className="payment-detail-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <dl className="void-summary">
          {details.map(([label, value, wide]) => (
            <div key={label} className={wide ? 'is-wide' : ''}>
              <dt>{label}</dt>
              <dd>{value || '—'}</dd>
            </div>
          ))}
          <div className="is-amount">
            <dt>Amount</dt>
            <dd>{amount}</dd>
          </div>
        </dl>

        {isVoided && (
          <p className="void-callout">
            This payment was voided. Reason: <strong>{payment.void_reason || 'Not recorded'}</strong>
          </p>
        )}

        <div className="payment-detail-actions">
          {canVoid && !isVoided && <button type="button" className="payments-secondary" onClick={onAmend}>Amend note</button>}
          {canVoid && !isVoided && (
            <button type="button" className="payments-secondary payment-detail-void" onClick={onVoid}>× Void payment</button>
          )}
          <span className="payment-detail-spacer" />
          <button type="button" className="payments-secondary" onClick={onClose}>Close</button>
          <button type="button" className="payments-primary" onClick={onReceipt}>View receipt</button>
        </div>
      </div>
    </div>
  )
}

export default function PaymentsPage({ user: suppliedUser }) {
  const location = useLocation()
  const navigate = useNavigate()
  const handledPaymentRequestRef = useRef(null)
  const paymentSubmitRef = useRef(false)
  const paymentSubmissionKeyRef = useRef(null)
  const paymentAttemptRef = useRef(null)
  const chargeSubmitRef = useRef(false)
  const voidSubmitRef = useRef(false)
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
  const [openOfTypeError, setOpenOfTypeError] = useState('')
  const [properties, setProperties] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [balancePopoverOpen, setBalancePopoverOpen] = useState(false)
  const balancePopoverRef = useRef({ trigger: null, panel: null, position: null })
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [paymentSaveNotice, setPaymentSaveNotice] = useState(null)
  const [specificPenaltyOptions, setSpecificPenaltyOptions] = useState([])
  const [specificPenaltyError, setSpecificPenaltyError] = useState('')
  const [specificPenaltyLoading, setSpecificPenaltyLoading] = useState(false)

  // No date manipulation: available penalties come from the same live unpaid-item
  // view used by the ledger. The database rechecks the target during insertion.
  useEffect(() => {
    if (!showForm || !form.propertyId || form.paymentPurpose !== 'Penalty / Late Fee') {
      setSpecificPenaltyOptions([])
      setSpecificPenaltyError('')
      setSpecificPenaltyLoading(false)
      return undefined
    }
    let cancelled = false
    setSpecificPenaltyLoading(true)
    setSpecificPenaltyError('')
    supabase.from('property_balance_items')
      .select('ref_id,label,unpaid,item_date')
      .eq('property_id', Number(form.propertyId))
      .eq('kind', 'penalty')
      .gt('unpaid', 0)
      .order('item_date', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return
        setSpecificPenaltyOptions(error ? [] : data || [])
        setSpecificPenaltyError(error ? 'Could not verify unpaid penalties. Refresh before selecting a charge.' : '')
        setSpecificPenaltyLoading(false)
      })
    return () => { cancelled = true }
  }, [showForm, form.propertyId, form.paymentPurpose, reloadTick])

  useEffect(() => {
    // When a different homeowner is selected, never retain the former charge ID.
    setForm((current) => current.specificChargeId
      ? { ...current, specificChargeId: '' }
      : current)
  }, [form.propertyId])
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [popupNotice, setPopupNotice] = useState('')
  const [duesSettings, setDuesSettings] = useState(null)
  const [advanceConfirm, setAdvanceConfirm] = useState(null)
  const [annualAdvancePrompt, setAnnualAdvancePrompt] = useState(false)
  const [annualPromotionBalance, setAnnualPromotionBalance] = useState(null)
  const [annualAdvance, setAnnualAdvance] = useState(false)
  const [changeHandling, setChangeHandling] = useState('advance')
  const [manualDiscount, setManualDiscount] = useState({
    enabled: false, chargeId: '', type: 'fixed',
    value: '', reason: '', approval: '',
  })
  const discountAttemptRef = useRef(null)

  const [monthlyDuesByProperty, setMonthlyDuesByProperty] = useState(new Map())
  // Advance-credit notes use the selected homeowner's own monthly dues (lot size x rate).
  const duesSettingsFor = (propertyId) => (duesSettings
    ? { ...duesSettings, monthly_dues: monthlyDuesByProperty.get(Number(propertyId)) || 0 }
    : null)
  const [chargeRows, setChargeRows] = useState([])
  const [chargeTotal, setChargeTotal] = useState(0)
  const [chargesLoading, setChargesLoading] = useState(false)
  const [chargesError, setChargesError] = useState('')
  const [showCharges, setShowCharges] = useState(false)
  const [chargeSearch, setChargeSearch] = useState('')
  const [voidTarget, setVoidTarget] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [detailPayment, setDetailPayment] = useState(null)
  const [noteAmendmentTarget, setNoteAmendmentTarget] = useState(null)
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
  const [range, setRange] = useState(() => {
    const today = todayDateKey()
    return { from: today, to: today, preset: 'today' }
  })
  const calendar = useAnimatedPopover()
  const calendarAnchorRef = useRef(null)
  const calendarPanelRef = useRef(null)

  const role = currentUser?.is_active === false ? '' : currentUser?.role?.trim().toLowerCase()
  const canManagePayments =
    role === 'admin' || role === 'secretary' || role === 'treasurer'
  // Adding or voiding a charge changes a homeowner's balance directly, so treasurers are excluded.
  const canManageCharges = role === 'admin' || role === 'secretary'
  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  // Presentation-only popover: retain the existing BalanceBreakdown data and posting callback.
  // Position is captured only when opened, not recalculated during scrolling.
  useEffect(() => { setBalancePopoverOpen(false) }, [form.propertyId, showForm])

  useEffect(() => {
    if (!balancePopoverOpen) return undefined
    const outside = (event) => {
      const { trigger, panel } = balancePopoverRef.current
      if (!trigger?.contains(event.target) && !panel?.contains(event.target)) {
        setBalancePopoverOpen(false)
      }
    }
    const focusOutside = (event) => {
      const { trigger, panel } = balancePopoverRef.current
      if (!trigger?.contains(event.target) && !panel?.contains(event.target)) {
        setBalancePopoverOpen(false)
      }
    }
    const escapePopover = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      setBalancePopoverOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusOutside)
    document.addEventListener('keydown', escapePopover, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusOutside)
      document.removeEventListener('keydown', escapePopover, true)
    }
  }, [balancePopoverOpen])

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
        !calendarAnchorRef.current?.contains(event.target) &&
        !calendarPanelRef.current?.contains(event.target)
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

  async function refreshPropertyBalance(propertyId) {
    try {
      const balance = await readPropertyBalance(supabase, propertyId)
      setProperties((current) => current.map((property) =>
        Number(property.id) === Number(propertyId)
          ? { ...property, current_balance: balance }
          : property))
    } catch (error) {
      // The mutation may already have committed; never invent a replacement balance.
      setPageError(`The change was saved, but the latest homeowner balance could not be loaded. Refresh before the next transaction. ${error.message}`)
    }
  }

  async function loadPage() {
    setLoading(true)
    setPageError('')

    try {
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
        .eq('charge_type', 'Association Dues')
        .is('voided_at', null)
        .eq('billing_month', `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 7)}-01`)
        .limit(1),
      fetchAll(() => supabase
        .from('property_monthly_dues')
        .select('property_id, monthly_dues')
        .order('property_id'), { tiebreaker: null }),
    ])

    const errors = paymentSetupErrors({ propertyResult, settingsResult, billedResult, duesResult })
    if (errors.length) {
      setPageError(`Payment setup could not be fully loaded: ${errors.join(' ')}`)
      return
    }
    setDuesSettings({
      ...settingsResult.data,
      billed_this_month: billedResult.data.length > 0,
    })
    setMonthlyDuesByProperty(new Map(duesResult.data.map((row) => [Number(row.property_id), row.monthly_dues])))
    setProperties(propertyResult.data)
    } catch (error) {
      setPageError(`Payment setup could not be loaded: ${error?.message || 'Connection failed.'}`)
    } finally {
      setLoading(false)
    }
  }

  const openPaymentDraft = useCallback((property) => {
    if (!canManagePayments || paymentSubmitRef.current) return
    paymentSubmissionKeyRef.current = null
    paymentAttemptRef.current = null
    discountAttemptRef.current = null
    advanceApprovedRef.current = false
    setAdvanceConfirm(null)
    setChangeHandling('advance')
    setManualDiscount({ enabled: false, chargeId: '', type: 'fixed', value: '', reason: '', approval: '' })
    setForm(property ? { ...EMPTY_FORM, ...paymentLotFields(property) } : EMPTY_FORM)
    setFormError('')
    setHomeownerMenuOpen(false)
    setAnnualAdvancePrompt(false)
    setAnnualPromotionBalance(null)
    setAnnualAdvance(false)
    setShowForm(true)
  }, [canManagePayments])

  // A profile's Record Payment button carries only its lot ID. Wait for the
  // current ledger and role, then consume the request so closing/refreshing the
  // form does not reopen it. Name, lot and balance come from the fresh ledger.
  useEffect(() => {
    const propertyId = location.state?.recordPaymentPropertyId
    if (propertyId == null || loading || saving || !canManagePayments || pageError) return
    if (handledPaymentRequestRef.current === location.key) return
    handledPaymentRequestRef.current = location.key

    const property = findActivePaymentLot(properties, propertyId)
    if (property) {
      openPaymentDraft(property)
    } else {
      setPageError('This lot is no longer active or available. Select an active homeowner to record a payment.')
    }

    const remainingState = { ...location.state }
    delete remainingState.recordPaymentPropertyId
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: Object.keys(remainingState).length ? remainingState : null },
    )
  }, [location, loading, saving, canManagePayments, pageError, properties, navigate, openPaymentDraft])

  // Dues payments come off the balance in full (extra becomes advance credit).
  // Fees/penalties only pay off an open charge of the same type; otherwise they are a one-time fee.
  const purposeType = PAYMENT_PURPOSES.includes(form.paymentPurpose)
    ? form.paymentPurpose
    : form.paymentPurpose
      ? 'Other'
      : ''
  const isBalanceReducingPayment =
    isBalanceReducingPurpose(purposeType)

  // How much of this homeowner's fee charge is still unpaid. Only this one
  // homeowner's rows are read, and the formula matches the database trigger that
  // makes the final decision: charged minus (balance_effect - effect_released).
  useEffect(() => {
    if (!form.propertyId || isBalanceReducingPayment) {
      setOpenOfType(0)
      setOpenOfTypeError('')
      return undefined
    }
    setOpenOfTypeError('Checking unpaid charges…')

    let cancelled = false
    const propertyId = Number(form.propertyId)

    async function loadOpenAmount() {
      try {
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
          .or('status.is.null,status.neq.Voided')),
      ])

      if (cancelled) return
      if (chargeResult.error || paidResult.error) {
        setOpenOfType(0)
        setOpenOfTypeError('Unable to verify unpaid charges. Refresh and try again.')
        return
      }
      setOpenOfTypeError('')

      const charged = (chargeResult.data || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
      const applied = (paidResult.data || []).reduce(
        (sum, row) => sum + (Number(row.balance_effect) || 0) - (Number(row.effect_released) || 0),
        0,
      )
      setOpenOfType(Math.max(Math.round((charged - applied) * 100) / 100, 0))
      } catch {
        if (!cancelled) {
          setOpenOfType(0)
          setOpenOfTypeError('Unable to verify unpaid charges. Refresh and try again.')
        }
      }
    }

    loadOpenAmount()
    return () => { cancelled = true }
  }, [form.propertyId, isBalanceReducingPayment, purposeType, reloadTick])

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


  const manualDiscountAmount =
    !annualAdvance && /^\d+(\.\d{1,2})?$/.test(manualDiscount.value)
      ? Number(manualDiscount.value)
      : 0
  // The entered payment is money actually received, never a face amount
  // reduced by a debt discount. Returned change is deducted separately.
  const paymentFaceAmount = Math.round((Number(form.amountPaid) || 0) * 100) / 100
  const cashTendered = paymentFaceAmount
  const balanceDue = Math.round((Number(form.previousBalance) || 0) * 100) / 100
  const canChooseChange = Boolean(form.propertyId) && !annualAdvance &&
    form.paymentMethod === 'Cash' && isBalanceReducingPayment &&
    balanceDue > 0 && manualDiscountAmount < balanceDue &&
    paymentFaceAmount > balanceDue - manualDiscountAmount && cashTendered > 0
  const excessAmount = canChooseChange
    ? Math.round((paymentFaceAmount - (balanceDue - manualDiscountAmount)) * 100) / 100
    : 0
  const changeAmount = canChooseChange && changeHandling === 'change' ? excessAmount : 0

  const remainingBalance = useMemo(() => {
  const previous = Number(form.previousBalance) || 0
  const paid = annualAdvance
    ? annualDiscountedPayment
    : Math.round((Number(form.amountPaid) || 0) * 100) / 100 - changeAmount

  const effect =
    annualAdvance || isBalanceReducingPayment || purposeType !== 'Other'
      ? paid
      : Math.min(paid, openOfType)

  return Math.round((previous - effect - manualDiscountAmount - (annualAdvance ? annualDiscount : 0)) * 100) / 100
}, [
  form.previousBalance,
  form.amountPaid,
  annualAdvance,
  annualDiscountedPayment,
  annualDiscount,
  isBalanceReducingPayment,
  purposeType,
  openOfType,
  manualDiscountAmount,
  changeAmount,
])

  // ---- Paged payment history -------------------------------------------------
  // The table shows one day at a time (50 rows per page), read straight from the database.
  //   * Default view: today's payments.
  //   * Use the arrows or the calendar button to look at another day.
  //   * Typing a search looks through ALL dates.
  const debouncedSearch = useDebouncedValue(searchTerm, 350)
  const searching = searchTokens(debouncedSearch).length > 0
  const todayKey = todayDateKey()
  const isToday = range.from === todayKey && range.to === todayKey
  const isSingleDay = range.from === range.to
  const scopeKind = searching ? 'search' : 'day'
  const listRange = searching ? null : dateSpanRange(range.from, range.to)
  const scopeKey = `${scopeKind}|${range.from}|${range.to}|${statusFilter}|${debouncedSearch}`

  // The page number belongs to one scope; changing day/search starts at page 1.
  const page = pageState.key === scopeKey ? pageState.page : 0
  function goToPage(nextPage) {
    setPageState({ key: scopeKey, page: Math.max(0, nextPage) })
  }

  useEffect(() => {
    let cancelled = false

    async function loadRows() {
      setListLoading(true)
      try {
      const { from, to } = pageWindow(page)

      // Browsing a day gets an exact total (cheap: it uses the date index).
      // An open-ended search skips the exact count - counting every match in a big
      // table is slow and unnecessary - and asks for one extra row to learn whether
      // a next page exists.
      const exact = scopeKind !== 'search'
      let query = supabase.from('payments').select('*', exact ? { count: 'exact' } : undefined)
      query = applyTimeRange(query, 'paid_at', listRange)
      query = applySearch(query, PAYMENT_SEARCH_COLUMNS, debouncedSearch)
      if (statusFilter === 'voided') query = query.eq('status', 'Voided')
      if (statusFilter === 'completed') query = query.or('status.is.null,status.neq.Voided')

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
      } catch (failure) {
        if (!cancelled) {
          setListError(`Could not load payments: ${failure?.message || 'Connection failed.'}`)
          setRows([])
          setPageInfo({ total: 0, minimum: 0 })
        }
      } finally {
        if (!cancelled) setListLoading(false)
      }
    }

    loadRows()
    return () => { cancelled = true }
  }, [scopeKey, page, reloadTick])

  // Totals for the single day being viewed - computed by the database.
  const formatKey = (key) => organization.formatDate(`${key}T12:00:00`)
  const rangeLabel = (from, to, preset) => {
    const named = paymentPresets(todayKey).find((item) => item.id === preset)
    if (named && !['today', 'yesterday'].includes(preset)) return named.label
    if (from === to) return from === todayKey ? 'Today' : formatKey(from)
    return `${formatKey(from)} – ${formatKey(to)}`
  }
  const dayLabel = rangeLabel(range.from, range.to, range.preset)
  const summaryRange = dateSpanRange(range.from, range.to)
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
  const leavingAnnualAdvance =
    name === 'paymentPurpose' && annualAdvance

  if (leavingAnnualAdvance) {
    setAnnualAdvance(false)
  }

  setForm((current) => ({
    ...current,
    [name]: value,
    ...(name === 'paymentPurpose' ? { specificChargeId: '' } : {}),
    ...(leavingAnnualAdvance
      ? {
          amountPaid: '',
          coveragePeriod: '',
        }
      : {}),
  }))

  if (name === 'paymentPurpose') {
    setAnnualAdvancePrompt(false)
    setAnnualPromotionBalance(null)
  }

  setFormError('')
}

function requestAnnualPromotion() {
  if (saving) return
  if (annualAdvance) {
    chooseAnnualAdvance(false)
    return
  }
  if (!form.propertyId || form.paymentPurpose !== 'Association Dues') return
  if (Number(form.previousBalance) > 0) {
    setAnnualPromotionBalance(Number(form.previousBalance))
    return
  }
  if (!canOfferAnnualDiscount) {
    setFormError('The annual promotion is not available. Refresh the account details and verify the monthly dues first.')
    return
  }
  if (manualDiscount.enabled) {
    setFormError('Remove the manual discount before applying the 12-month promotion. Discounts cannot be stacked.')
    return
  }
  setAnnualAdvancePrompt(true)
}

function chooseAnnualAdvance(enabled) {
  if (enabled && !canOfferAnnualDiscount) {
    setAnnualAdvancePrompt(false)
    if (Number(form.previousBalance) > 0) setAnnualPromotionBalance(Number(form.previousBalance))
    else setFormError('The annual promotion is not available for this account. Refresh the account details and try again.')
    return
  }
  setChangeHandling('advance')
  setAnnualAdvancePrompt(false)
  setAnnualAdvance(enabled)
  setForm((current) => ({
    ...current,
    amountPaid: enabled ? annualDiscountedPayment.toFixed(2) : '',
    coveragePeriod: enabled
      ? '12-month payment (1 month free)'
      : '',
  }))
  setFormError('')
}

function updateHomeownerSearch(event) {
  const { value } = event.target
  const wasAnnualAdvance = annualAdvance

  if (wasAnnualAdvance) {
    setAnnualAdvance(false)
  }

  setForm((current) => ({
    ...current,
    propertyId: '',
    homeownerName: value,
    blockName: '',
    lotNumber: '',
    previousBalance: '',
    ...(wasAnnualAdvance
      ? {
          amountPaid: '',
          coveragePeriod: '',
        }
      : {}),
  }))

  setHomeownerMenuOpen(true)
  setFormError('')
}


  // A penalty that fell due was just posted for the selected homeowner: refresh their balance.
  async function handlePenaltiesPosted() {
    const id = form.propertyId
    if (!id) return
    try {
      const balance = await readPropertyBalance(supabase, Number(id))
      setProperties((current) =>
        current.map((property) => (String(property.id) === String(id) ? { ...property, current_balance: balance } : property)),
      )
      setForm((current) => (String(current.propertyId) === String(id) ? { ...current, previousBalance: String(balance) } : current))
    } catch (error) {
      setPageError(`Penalties may have been posted, but the updated balance could not be verified. Refresh before recording another payment. ${error.message}`)
      setForm((current) => (String(current.propertyId) === String(id) ? { ...current, previousBalance: '' } : current))
    }
  }

  
function selectHomeowner(property) {
  const wasAnnualAdvance = annualAdvance
  setAnnualAdvance(false)
  setAnnualAdvancePrompt(false)
  setAnnualPromotionBalance(null)


  setForm((current) => ({
    ...current,
    ...paymentLotFields(property),
    ...(wasAnnualAdvance
      ? {
          amountPaid: '',
          coveragePeriod: '',
        }
      : {}),
  }))

  setHomeownerMenuOpen(false)
  setFormError('')
}


  function openForm() {
    openPaymentDraft()
  }

  function closeForm() {
    if (saving) return
    setChangeHandling('advance')
    setAnnualAdvancePrompt(false)
    setAnnualPromotionBalance(null)
    setAnnualAdvance(false)
    setShowForm(false)
    setFormError('')
  }

  function applyDateRange(from, to, preset) {
    setRange({ from, to, preset })
    calendar.hide()
  }

  function goToToday() {
    const today = todayDateKey()
    setRange({ from: today, to: today, preset: 'today' })
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
    if (chargeSubmitRef.current) return

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
    if (!CHARGE_TYPES.includes(chargeForm.chargeType)) {
      setChargeError('Select a valid charge type.')
      return
    }
    if (!isValidManualChargeDueDate(chargeForm.dueDate, todayDateKey())) {
      setChargeError('Select a valid final due date (today or later).')
      return
    }

    chargeSubmitRef.current = true
    setChargeSaving(true)
    setChargeError('')

    try {
    const { data, error } = await supabase.from('property_charges').insert({
      property_id: property.id,
      charge_type: chargeForm.chargeType,
      description: chargeForm.description.trim() || null,
      amount,
      due_date: chargeForm.dueDate,
      created_by: currentUser.id,
      created_by_name: recorderName,
    }).select('id, property_id, charge_type, amount, billing_month, due_date, description, created_by_name, created_at').single()

    if (error) {
      setChargeError(error.message)
      return
    }
    if (!data?.id || String(data.property_id) !== String(property.id) || data.due_date !== chargeForm.dueDate) {
      setChargeError('Charge save could not be verified. Refresh charge history before retrying to avoid a duplicate.')
      return
    }

    await refreshPropertyBalance(property.id)
    setReloadTick((tick) => tick + 1)
    notifySuccess(`${chargeForm.chargeType} charge of ${peso.format(amount)} added for ${property.homeowner_name}, ${property.block}, Lot ${property.lot_number}.`)
    setShowCharge(false)
    } catch (error) {
      setChargeError(`The charge could not be confirmed. Refresh before retrying. ${error.message}`)
    } finally {
      chargeSubmitRef.current = false
      setChargeSaving(false)
    }
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
      setChargeRows([])
      setChargesError('')

      try {
      const { data, error, count } = await loadOpenCharges(supabase, properties, debouncedChargeSearch)

      if (cancelled) return
      setChargeRows(error ? [] : data || [])
      setChargesError(error ? 'Charges could not be loaded. Close this window and try again.' : '')
      setChargeTotal(error ? 0 : count || 0)
      } catch {
        if (!cancelled) {
          setChargeRows([])
          setChargeTotal(0)
          setChargesError('Charges could not be loaded. Close this window and try again.')
        }
      } finally {
        if (!cancelled) setChargesLoading(false)
      }
    }

    loadCharges()
    return () => { cancelled = true }
  }, [showCharges, debouncedChargeSearch, reloadTick, properties])

  useEffect(() => {
    if (!voidTarget) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape' && !voiding) setVoidTarget(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [voidTarget, voiding])

  async function openReceipt(payment) {
    const { data: discount, error } = await supabase
      .from('manual_payment_discounts').select('*')
      .eq('payment_id', payment.id).maybeSingle()
    if (error) {
      setPopupNotice('Could not verify the receipt discount. Please retry.')
      return
    }
    setDetailPayment(null)
    setReceipt({
      ...payment,
      manual_discount: discount || null,
      remaining_balance: discount
        ? Math.round((Number(payment.remaining_balance) -
            Number(discount.discount_amount)) * 100) / 100
        : payment.remaining_balance,
    })
  }

  function voidFromDetail(payment) {
    setDetailPayment(null)
    openVoid('payment', payment)
  }

  function openVoid(kind, item) {
    setVoidTarget({ kind, item })
    setVoidReason('')
    setVoidError('')
  }

  async function confirmVoid(event) {
    event.preventDefault()
    if (voidSubmitRef.current || !voidTarget) return
    const reason = voidReason.trim()

    if (reason.length < 5) {
      setVoidError('Enter a reason (at least 5 characters).')
      return
    }

    voidSubmitRef.current = true
    setVoiding(true)
    setVoidError('')
    const { kind, item } = voidTarget
    try {

    if (kind === 'payment') {
      const { data, error } = await supabase
        .from('payments')
        .update({ status: 'Voided', void_reason: reason })
        .eq('id', item.id)
        .or('status.is.null,status.neq.Voided')
        .select('id')

      if (error || !Array.isArray(data) || data.length !== 1 || String(data[0]?.id) !== String(item.id)) {
        setVoidError(error?.message || 'Could not confirm this payment cancellation. Refresh before trying again.')
        setVoiding(false)
        return
      }

      setReloadTick((tick) => tick + 1)
      await refreshPropertyBalance(item.property_id)

    } else {
      const { data, error } = await supabase
        .from('property_charges')
        .update({ voided_at: new Date().toISOString(), void_reason: reason })
        .eq('id', item.id)
        .is('voided_at', null)
        .select('id')

      if (error || !Array.isArray(data) || data.length !== 1 || String(data[0]?.id) !== String(item.id)) {
        setVoidError(error?.message || 'Could not confirm this charge cancellation. Refresh before trying again.')
        setVoiding(false)
        return
      }

      setReloadTick((tick) => tick + 1)
      await refreshPropertyBalance(item.property_id)

    }

    notifySuccess(kind === 'payment'
      ? `Payment ${item.receipt_number || ''} was cancelled.`
      : `${item.charge_type} charge was cancelled.`)
    setVoidTarget(null)
    } catch (error) {
      setVoidError(`Cancellation could not be confirmed. Refresh before retrying. ${error.message}`)
    } finally {
      voidSubmitRef.current = false
      setVoiding(false)
    }
  }

  function confirmAdvancePayment() {
    advanceApprovedRef.current = true
    setAdvanceConfirm(null)
    recordPayment({ preventDefault() {} })
  }

  async function recordPayment(event) {
    event.preventDefault()
    if (paymentSubmitRef.current) return
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
    const gross = Number(form.amountPaid)
    const paid = annualAdvance
      ? gross
      : Math.round((gross - changeAmount) * 100) / 100
    if (changeHandling === 'change' && !canChooseChange) {
      setFormError('The balance or payment details changed. Recheck the change or choose advance credit.')
      return
    }
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
    if (form.specificChargeId) {
      const target = specificPenaltyOptions.find((item) => item.ref_id === form.specificChargeId)
      if (form.paymentPurpose !== 'Penalty / Late Fee' || !target || specificPenaltyError ||
          specificPenaltyLoading || manualDiscount.enabled || annualAdvance || changeAmount > 0) {
        setFormError('Choose an available penalty and pay it without annual discounts, manual discounts or returned change.')
        return
      }
      if (Math.round(paid * 100) > Math.round(Number(target.unpaid) * 100)) {
        setFormError('The payment exceeds the selected penalty balance. Reload the account and verify the amount.')
        return
      }
    }
    if (annualAdvance) {
  if (!canOfferAnnualDiscount) {
    if (Number(form.previousBalance) > 0) setAnnualPromotionBalance(Number(form.previousBalance))
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

    const advance = manualDiscount.enabled ? null : paymentAdvanceConfirmation({
      purpose: form.paymentPurpose, paid, previous, openOfType, annualAdvance,
    })
    if (advance && !advanceApproved) {
      setAdvanceConfirm(advance)
      return
    }

    if (form.paymentMethod !== 'Cash' && !reference) {
      setFormError('A reference number is required for non-cash payments.')
      return
    }
    if (!isBalanceReducingPayment && openOfTypeError) {
      setFormError('Unpaid charges are still being checked. Please retry when the check finishes.')
      return
    }

    if (manualDiscount.value.trim() !== '' &&
        (!/^\d+(\.\d{1,2})?$/.test(manualDiscount.value) ||
         manualDiscountAmount < 0 ||
         manualDiscountAmount >= gross ||
         annualAdvance)) {
      setFormError('Enter a valid discount below the original amount. Discounts cannot be stacked.')
      return
    }
    if (manualDiscount.enabled && !manualDiscountSettlesFullBalance({
      outstandingBalance: previous,
      cashRetained: paid,
      discountAmount: manualDiscountAmount,
      isBalanceReducingPayment,
    })) {
      setFormError('Manual discounts require full settlement of the outstanding debt. Partial payments and retained advance credits are not eligible. Return any excess as change or remove the discount.')
      return
    }
    // A draft has no timer. Generate a key for its first valid submission,
    // and retain it while the same submission is being retried.
    const paymentSubmissionKey = paymentSubmissionKeyRef.current ??= crypto.randomUUID()
    paymentSubmitRef.current = true
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
  specific_charge_id: form.paymentPurpose === 'Penalty / Late Fee' && form.specificChargeId
    ? form.specificChargeId
    : null,
  previous_balance: previous,

  // amount is the full dues credit; amount_paid is the cash actually received.
  amount: annualAdvance ? annualGross : paid,
  amount_paid: paid,

  receipt_breakdown: changeAmount > 0
    ? { returned_change: { cash_tendered: cashTendered, change_amount: changeAmount, gross_before_discount: balanceDue, discount_amount: manualDiscountAmount } }
    : annualAdvance
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
  submission_key: paymentSubmissionKey,
}

    try {
      const paymentIntent = financialSubmissionIntent('payment', payload)
      const discountFingerprint = JSON.stringify(manualDiscount)
      if (paymentAttemptRef.current &&
          discountAttemptRef.current !== discountFingerprint) {
        throw new Error('Discount details changed after a submission attempt. Review history first.')
      }
      if (!paymentAttemptRef.current) discountAttemptRef.current = discountFingerprint
      requireUnchangedFinancialAttempt(paymentAttemptRef.current, paymentIntent)
      let data = null

      // A previous request might have committed before its response was lost.
      // Look up the original key BEFORE trying a second insert.
      if (paymentAttemptRef.current) {
        const previous = await supabase.from('payments').select('*')
          .eq('submission_key', paymentSubmissionKey).maybeSingle()
        if (previous.error) throw new Error('Could not check the original payment. Review receipt history before retrying.')
        if (previous.data) data = assertFinancialSubmissionMatches(paymentAttemptRef.current, previous.data)
      }

      if (!data) {
        paymentAttemptRef.current = paymentIntent
        let result
        if (manualDiscount.enabled) {
          // Atomic debt discount + entire retained cash (including advance credit).
          // The old RPC treats its gross argument as debt, not physical cash.
          const response = await supabase.rpc('record_cash_payment_with_debt_discount', {
            p_property_id: Number(form.propertyId),
            p_cash_tendered: gross,
            p_discount_amount: manualDiscountAmount,
            p_change_amount: changeAmount,
            p_charge_type: payload.charge_type,
            p_coverage_period: payload.coverage_period,
            p_payment_method: form.paymentMethod,
            p_reference_number: reference || null,
            p_note: payload.note,
            p_submission_key: paymentSubmissionKey,
          })
          result = { data: response.data?.payment || null, error: response.error }
        } else if (changeAmount > 0) {
          const response = await supabase.rpc('record_payment_with_returned_change', {
            p_property_id: Number(form.propertyId),
            p_original_amount: gross,
            p_discount_amount: manualDiscountAmount,
            p_change_amount: changeAmount,
            p_charge_type: payload.charge_type,
            p_coverage_period: payload.coverage_period,
            p_payment_method: form.paymentMethod,
            p_reference_number: reference || null,
            p_note: payload.note,
            p_submission_key: paymentSubmissionKey,
          })
          result = { data: response.data?.payment || null, error: response.error }
        } else {
          result = await supabase.from('payments').insert(payload).select('*').single()
        }
        if (result.error) {
          if (manualDiscount.enabled && result.error.code === '22023' && (
            result.error.message === 'There is no outstanding debt eligible for this discount.' ||
            result.error.message === 'The original amount exceeds the unpaid charges for this payment purpose.' ||
            result.error.message === 'The discount must be smaller than the eligible outstanding debt.' ||
            result.error.message === 'The discount exceeds the eligible debt payment.' ||
            result.error.message === 'The amount of change no longer matches the outstanding balance.'
          )) {
            // The RPC rejected this save before recording a payment.
            paymentAttemptRef.current = null
            discountAttemptRef.current = null
            paymentSubmissionKeyRef.current = null
            setPaymentSaveNotice({ title: 'Payment not saved', message: result.error.message })
            return
          }
          const previous = await supabase.from('payments').select('*')
            .eq('submission_key', paymentSubmissionKey).maybeSingle()
          if (previous.error) throw new Error('Receipt recovery is unavailable. Do not submit again until history has been checked.')
          if (!previous.data) throw result.error
          result = { data: previous.data, error: null }
        }
        data = assertFinancialSubmissionMatches(paymentAttemptRef.current, result.data)
      }

    if (manualDiscount.enabled) {
      const { data: audit, error: auditError } = await supabase
        .from('manual_payment_discounts').select('*')
        .eq('payment_id', data.id).single()

      if (auditError || !audit ||
          Number(audit.gross_amount) !== Math.round((paid + manualDiscountAmount) * 100) / 100 ||
          Number(audit.discount_amount) !== manualDiscountAmount ||
          Number(audit.cash_received) !== paid) {
        throw new Error('Discount journal could not be verified. Review payment history before retrying.')
      }

      data = {
        ...data,
        manual_discount: audit,
        remaining_balance: Math.round(
          (Number(data.remaining_balance) - Number(audit.discount_amount)) * 100
        ) / 100,
      }
    }
    goToPage(0)
    // Jump to today so the new receipt is visible even if another day was open.
    goToToday()
    setReloadTick((tick) => tick + 1)
    await refreshPropertyBalance(data.property_id)
    setShowForm(false)
    setForm(EMPTY_FORM)
    setManualDiscount({
      enabled: false, chargeId: '', type: 'fixed',
      value: '', reason: '', approval: '',
    })
    discountAttemptRef.current = null
    setChangeHandling('advance')
    setReceipt(data)
    paymentAttemptRef.current = null
    paymentSubmissionKeyRef.current = null
    notifySuccess(`Payment ${data.receipt_number} recorded for ${data.homeowner_name}, ${data.block_name || ""}, Lot ${data.lot_number || ""}.`)
    } catch (error) {
      setPaymentSaveNotice({
        title: 'Payment could not be confirmed',
        message: `Refresh payment history before retrying to avoid a duplicate. ${error.message}`,
      })
    } finally {
      paymentSubmitRef.current = false
      setSaving(false)
    }
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
            <button className="payments-primary" type="button" onClick={openForm} disabled={saving}>
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
          <span className="payments-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7h18v12H3z" /><path d="M3 10h18M7 15h3" /></svg></span>
          <span className="payments-summary-label">Total collected</span>
          <strong>{summary ? peso.format(Number(summary.dues_collected) || 0) : '—'}</strong>
          <small>Excludes voided payments · {summaryLabel}</small>
        </article>
        <article className="payments-summary-card payments-summary-records">
          <span className="payments-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 4h14v16H5z" /><path d="m8 12 2.5 2.5L16 9" /></svg></span>
          <span className="payments-summary-label">Completed payments</span>
          <strong>{summary ? summary.completed_count : '—'}</strong>
          <small>{summary ? summary.payment_count : 0} record{summary?.payment_count === 1 ? '' : 's'} · {summaryLabel}</small>
        </article>
        <article className="payments-summary-card payments-summary-homeowners">
          <span className="payments-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3 2.5-5 6-5s6 2 6 5M16 11a3 3 0 1 0 0-6M16 14c3 0 5 1.8 5 5" /></svg></span>
          <span className="payments-summary-label">Homeowners served</span>
          <strong>{summary ? summary.homeowners_served : '—'}</strong>
          <small>Unique properties collected</small>
        </article>
        <article className="payments-summary-card payments-summary-voided">
          <span className="payments-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></svg></span>
          <span className="payments-summary-label">Voided</span>
          <strong>{summary ? summary.voided_count : '—'}</strong>
          <small>Balance corrected automatically</small>
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
                  ? "Today's payments. Use the calendar button for other days or ranges, or search all dates."
                  : `Payments recorded: ${dayLabel}.`}
            </p>
          </div>
          <div className="payments-tabs" role="group" aria-label="Filter by status">
            {[
              ['all', 'All', summary?.payment_count],
              ['completed', 'Completed', summary?.completed_count],
              ['voided', 'Voided', summary?.voided_count],
            ].map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={statusFilter === key}
                onClick={() => setStatusFilter(key)}
              >
                {label}
                {!searching && <span className="payments-tab-count">{count ?? '—'}</span>}
              </button>
            ))}
          </div>
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
              {isSingleDay && (
                <button
                  type="button"
                  aria-label="Previous day"
                  disabled={listLoading}
                  onClick={() => setRange({ from: shiftDateKey(range.from, -1), to: shiftDateKey(range.from, -1), preset: 'custom' })}
                >
                  ‹
                </button>
              )}
              <button
                type="button"
                className={`payments-day-label-btn ${calendar.open ? 'is-open' : ''}`}
                onClick={calendar.toggle}
                aria-expanded={calendar.open}
                aria-haspopup="dialog"
                aria-label="Choose dates"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18M8 3v4M16 3v4" />
                </svg>
                {isToday ? `Today · ${formatKey(todayKey)}` : dayLabel}
              </button>
              {isSingleDay && (
                <button
                  type="button"
                  aria-label="Next day"
                  disabled={listLoading || range.from >= todayKey}
                  onClick={() => setRange({ from: shiftDateKey(range.from, 1), to: shiftDateKey(range.from, 1), preset: 'custom' })}
                >
                  ›
                </button>
              )}
              {!isToday && (
                <button type="button" className="payments-day-today" onClick={goToToday}>
                  Today
                </button>
              )}

            </div>
          )}

          {searching && <span className="payments-date-chip">All dates</span>}
          <span className="payments-result-count">{listLoading ? '…' : countLabel(pageInfo)}</span>
        </div>

        {calendar.mounted && !searching && (
          <div
            ref={calendarPanelRef}
            className={`payments-calendar-animation payments-calendar-in-flow ${calendar.visible ? 'is-visible' : ''}`}
          >
            <PaymentDateRange
              from={range.from}
              to={range.to}
              preset={range.preset}
              todayKey={todayKey}
              activeDateKeys={activeDateKeys}
              onViewMonthChange={loadActiveDays}
              onApply={applyDateRange}
              onCancel={calendar.hide}
              formatLabel={rangeLabel}
            />
          </div>
        )}

        <div className="payments-history-wrap">
        <table className="payments-table payments-history-table">
          <thead>
            <tr>
              <th>Receipt / Date</th>
              <th>Homeowner / Property</th>
              <th>Payment details</th>
              <th>Amount / Method</th>
              <th>Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listLoading && rows.length === 0 ? (
              <tr><td colSpan="6" className="payments-empty"><div aria-busy="true"><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><span className="skeleton-region-status" role="status">Loading</span></div></td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan="6" className="payments-empty">
                  {scopeKind === 'day' ? (
                    <>
                      <strong>No payments recorded {isToday ? 'today' : `for ${dayLabel}`}</strong>
                      <span>Use the calendar button to check another day or range, or search to look through every date.</span>
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
                <tr
                  key={payment.id}
                  className={`payments-row-clickable ${payment.status === 'Voided' ? 'payments-row-voided' : ''}`}
                  tabIndex={0}
                  aria-label={`View ${payment.receipt_number}`}
                  onClick={() => setDetailPayment(payment)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      setDetailPayment(payment)
                    }
                  }}
                >
                  <td data-label="Receipt / Date">
                    <strong className="payments-receipt-number">{payment.receipt_number}</strong>
                    <small className="payments-secondary-text">
                      {organization.formatDate(payment.paid_at, { withTime: true })}
                    </small>
                    {!payment.recorded_by && (
                      <small className="payments-secondary-text">Historical record — recorder account not linked</small>
                    )}
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
                    <div className="payments-row-actions" onClick={(event) => event.stopPropagation()}>
                      <button className="payments-link" type="button" onClick={() => setDetailPayment(payment)}>
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
        </div>

        <Pager page={page} total={pageInfo.total} onPageChange={goToPage} disabled={listLoading} />
      </section>

      {showForm && canManagePayments && (
        <div className="payments-overlay" onMouseDown={closeForm}>
          <form className="payment-form payment-form--record payment-html-match" role="dialog" aria-modal="true" aria-labelledby="payment-record-title" onSubmit={recordPayment} onMouseDown={(e) => e.stopPropagation()} autoComplete="off" inert={saving ? "inert" : undefined} aria-busy={saving}>
            <div className="payment-modal-heading">
              <div>
                <span className="payment-record-eyebrow">Homeowner collections</span>
                <h2 id="payment-record-title">Record Payment</h2>
                <p>Choose an account and enter the payment details.</p>
              </div>
              <button type="button" className="payments-close" onClick={closeForm} aria-label="Close">×</button>
            </div>

            <div className="payment-form-grid payment-record-body">
              <section className="payment-record-details" aria-labelledby="payment-details-title">
                <h3 className="payment-record-section-label" id="payment-details-title">Account &amp; payment details</h3>
                <div className="payment-record-fields">
                  <div className="payment-homeowner-field">
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
                            <div className="payment-homeowner-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="38px" /><Skeleton variant="rect" width="100%" height="38px" /><span className="skeleton-region-status" role="status">Loading</span></div>
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
                                <span>{property.homeowner_name} — {property.block}, Lot {property.lot_number}</span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="payment-record-pair">
                    <label htmlFor="payment-block">Block
                      <input id="payment-block" name="blockName" value={form.blockName} placeholder="Filled from ledger" readOnly required />
                    </label>
                    <label htmlFor="payment-lot">Lot number
                      <input id="payment-lot" name="lotNumber" value={form.lotNumber} placeholder="Filled from ledger" readOnly required />
                    </label>
                  </div>
                  <div className="payment-record-field payment-purpose-field">
                    <label id="payment-purpose-label">Payment Purpose</label>
                    <div className="payment-purpose-select-wrap" aria-labelledby="payment-purpose-label">
                      <Select ariaLabel="Payment Purpose" value={form.paymentPurpose} onChange={(value) => updateField({ target: { name: 'paymentPurpose', value } })} placeholder="Select payment purpose" options={PAYMENT_PURPOSES.map((purpose) => ({ value: purpose, label: purpose }))} />
                    </div>
                  </div>
                  <div className="payment-promotion-choice">
                    <div><strong>12-month dues promotion</strong><p>{annualAdvance ? '1 month free is applied to this annual payment.' : 'Pay 11 months and receive 12 months of coverage.'}</p></div>
                    <button type="button" className="payment-promotion-apply" onClick={requestAnnualPromotion}
                      disabled={saving || !form.propertyId || form.paymentPurpose !== 'Association Dues'}
                      aria-haspopup="dialog">{annualAdvance ? 'Remove promotion' : 'Apply promotion'}</button>
                  </div>
                  {form.paymentPurpose === 'Penalty / Late Fee' && (
                    <div className="payment-record-field payment-purpose-field">
                      <label id="specific-penalty-label">Apply payment to a particular penalty (optional)</label>
                      <div className="payment-purpose-select-wrap" aria-labelledby="specific-penalty-label">
                        <Select ariaLabel="Penalty allocation target" value={form.specificChargeId}
                          onChange={(value) => updateField({ target: { name: 'specificChargeId', value } })}
                          options={[
                            { value: '', label: 'General balance allocation (oldest dues may be paid first)' },
                            ...specificPenaltyOptions.map((item) => ({
                              value: item.ref_id,
                              label: `${item.label} — ${peso.format(Number(item.unpaid))} outstanding`,
                            })),
                          ]} />
                      </div>
                      <small>Select a penalty to settle that charge only; otherwise the normal account-wide allocation rules apply.</small>
                      {specificPenaltyLoading && <small role="status">Loading unpaid penalties…</small>}
                      {specificPenaltyError && <small role="alert">{specificPenaltyError}</small>}
                    </div>
                  )}
                  {form.paymentPurpose === 'Other' && (
                    <label htmlFor="payment-other-purpose">Other payment purpose
                      <input id="payment-other-purpose" name="customPaymentPurpose" value={form.customPaymentPurpose} onChange={updateField} placeholder="Enter the payment purpose" maxLength="80" required />
                    </label>
                  )}
                  <label htmlFor="payment-period">Coverage Period / Payment Details
                    <input id="payment-period" name="coveragePeriod" value={form.coveragePeriod} onChange={updateField} placeholder="e.g., July 2026 or Homeowner ID renewal" maxLength="120" required />
                  </label>
                </div>
              </section>

              <section className="payment-record-payment" aria-labelledby="payment-payment-title">
                <h3 className="payment-record-section-label" id="payment-payment-title">Payment</h3>
                <div className="payment-record-fields">
                  <label htmlFor="payment-amount">{annualAdvance ? 'Payment Amount (11 months)' : 'Payment Amount (actual amount received)'}
                    <input id="payment-amount" name="amountPaid" type="number" min="0.01" step="0.01" value={form.amountPaid} onChange={updateField} readOnly={annualAdvance} required />
                  </label>
                  <label htmlFor="payment-simple-discount">Discount (₱) — full balance settlement only
                    <input id="payment-simple-discount" type="number" min="0" step="0.01" placeholder="0.00" value={manualDiscount.value} disabled={saving || annualAdvance || !isBalanceReducingPayment || balanceDue <= 0}
                      onChange={(event) => setManualDiscount((d) => ({ ...d, value: event.target.value, enabled: Number(event.target.value) > 0, type: 'fixed' }))} />
                    <small>Manual discounts require full debt settlement. Use Apply promotion for the separate 12-month offer.</small>
                  </label>
                  <div className="payment-record-pair payment-method-pair">
                  <div className="payment-record-field">
                    <label id="payment-method-label">Payment Method</label>
                    <div aria-labelledby="payment-method-label">
                      <Select ariaLabel="Payment Method" value={form.paymentMethod} onChange={(value) => updateField({ target: { name: 'paymentMethod', value } })} options={['Cash', 'GCash', 'Bank Transfer', 'Check'].map((value) => ({ value, label: value }))} />
                    </div>
                  </div>
                  <label htmlFor="payment-reference">Reference Number {form.paymentMethod !== 'Cash' && '*'}
                    <input id="payment-reference" name="referenceNumber" value={form.referenceNumber} onChange={updateField} maxLength="100" required={form.paymentMethod !== 'Cash'} />
                  </label>
                  </div>
                  <label className="payment-record-note" htmlFor="payment-note">Notes (Optional)
                    <textarea id="payment-note" name="note" value={form.note} onChange={updateField} maxLength="250" rows="2" placeholder="Optional payment note" />
                  </label>
                </div>

                <div className="payment-record-summary" aria-live="polite" aria-label="Payment summary">
                  <h3 className="payment-summary-title">Payment summary</h3>
                  <div className="payment-record-summary-row">
                    <div className="payment-balance-anchor" ref={(node) => { balancePopoverRef.current.trigger = node }}>
                      <span>Total due</span>
                      {form.propertyId && (
                        <button
                          type="button"
                          className={`payment-balance-trigger${balancePopoverOpen ? ' is-open' : ''}`}
                          aria-expanded={balancePopoverOpen}
                          aria-controls="payment-balance-popover"
                          aria-haspopup="dialog"
                          onClick={(event) => {
                            if (balancePopoverOpen) {
                              setBalancePopoverOpen(false)
                              return
                            }
                            const rect = event.currentTarget.getBoundingClientRect()
                            const panelWidth = Math.min(280, window.innerWidth - 48)
                            const upward = rect.top >= 260 || rect.top > window.innerHeight - rect.bottom
                            balancePopoverRef.current.position = {
                              left: Math.max(16, Math.min(rect.left, window.innerWidth - panelWidth - 16)),
                              width: panelWidth,
                              ...(upward
                                ? { bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(80, rect.top - 24) }
                                : { top: rect.bottom + 8, maxHeight: Math.max(80, window.innerHeight - rect.bottom - 24) }),
                            }
                            setBalancePopoverOpen(true)
                          }}
                        >
                          Balance breakdown
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                        </button>
                      )}
                    </div>
                    <strong>{peso.format(Math.max(0, balanceDue))}</strong>
                  </div>
                  {manualDiscountAmount > 0 && !annualAdvance && (
                    <div className="payment-record-summary-row">
                      <span>Discount</span>
                      <strong>{`− ${peso.format(manualDiscountAmount)}`}</strong>
                    </div>
                  )}
                  <div className="payment-record-summary-row payment-record-summary-emphasis">
                    <span>Balance after discount</span>
                    <strong>{peso.format(Math.max(0, balanceDue - manualDiscountAmount))}</strong>
                  </div>
                  <div className="payment-record-summary-row">
                    <span>Cash received</span>
                    <strong>{peso.format(Math.max(0, cashTendered - changeAmount))}</strong>
                  </div>
                  {canChooseChange && (
                    <div className="payment-record-summary-row">
                      <span>{changeHandling === 'change' ? 'Change to return' : 'Advance credit'}</span>
                      <strong>{changeHandling === 'change' ? `− ${peso.format(excessAmount)}` : peso.format(excessAmount)}</strong>
                    </div>
                  )}
                  <div className="payment-record-summary-row payment-summary-total">
                    <span>Balance after payment</span><strong>{peso.format(remainingBalance)}</strong>
                  </div>
                  {annualAdvance && <p className="payment-record-hint">12-month advance payment includes one month free.</p>}
                  {manualDiscountAmount > 0 && !annualAdvance && !manualDiscountSettlesFullBalance({
                    outstandingBalance: balanceDue,
                    cashRetained: cashTendered - changeAmount,
                    discountAmount: manualDiscountAmount,
                    isBalanceReducingPayment,
                  }) && <p className="payment-record-hint" role="status">Manual discounts require full debt settlement with no retained advance credit. Return any excess as change, or remove the discount.</p>}
                  {form.propertyId && createPortal(
                    <div
                      id="payment-balance-popover"
                      ref={(node) => { balancePopoverRef.current.panel = node }}
                      className={`payment-balance-popover${balancePopoverOpen ? ' is-open' : ''}`}
                      role="dialog"
                      aria-label="Balance breakdown"
                      aria-hidden={!balancePopoverOpen}
                      inert={!balancePopoverOpen}
                      style={balancePopoverRef.current.position || undefined}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      <h3 className="payment-balance-popover-heading">Balance breakdown</h3>
                      <BalanceBreakdown propertyId={form.propertyId} postDue compact onPosted={handlePenaltiesPosted} />
                      <div className="payment-balance-popover-total">
                        <span>Total due</span>
                        <strong>{peso.format(Math.max(0, balanceDue))}</strong>
                      </div>
                    </div>,
                    document.body,
                  )}
                </div>
              </section>

              {canChooseChange && (
                <fieldset className="payment-change-choice payment-record-wide">
                  <legend>{`Handle the ${peso.format(excessAmount)} excess`}</legend>
                  <div className="payment-record-radio-cards">
                    <label className={changeHandling === 'change' ? 'is-selected' : ''}>
                      <input type="radio" name="changeHandling" value="change" checked={changeHandling === 'change'} disabled={saving} onChange={() => setChangeHandling('change')} />
                      <span><strong>Return as change</strong><small>Return {peso.format(excessAmount)}. Record {peso.format(cashTendered - excessAmount)} as cash received.</small></span>
                    </label>
                    <label className={changeHandling === 'advance' ? 'is-selected' : ''}>
                      <input type="radio" name="changeHandling" value="advance" checked={changeHandling === 'advance'} disabled={saving} onChange={() => setChangeHandling('advance')} />
                      <span><strong>Save as advance credit</strong><small>Keep the full {peso.format(cashTendered)} cash payment. The excess is available for future charges.</small></span>
                    </label>
                  </div>
                </fieldset>
              )}

              {canChooseChange && changeHandling === 'advance' && remainingBalance < 0 && !annualAdvance && (
                <p className="payment-record-advance-note payment-record-wide" role="status">
                  {advanceCreditNote(-remainingBalance, duesSettingsFor(form.propertyId))}
                </p>
              )}
              {formError && <p className="payments-error payment-record-wide" role="alert">{formError}</p>}
            </div>

            <div className="payment-actions">
              {(!form.propertyId || !form.homeownerName.trim() || !form.blockName || !form.lotNumber.trim() ||
                !form.paymentPurpose || (form.paymentPurpose === 'Other' && !form.customPaymentPurpose.trim()) ||
                !form.coveragePeriod.trim() || !(Number(form.amountPaid) > 0) ||
                (form.paymentMethod !== 'Cash' && !form.referenceNumber.trim())) && (
                <p className="payment-required-warning" role="status">
                  Complete all required fields before saving or creating a receipt.
                </p>
              )}
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
                        <div className="payment-homeowner-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="38px" /><Skeleton variant="rect" width="100%" height="38px" /><span className="skeleton-region-status" role="status">Loading</span></div>
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
                <Select ariaLabel="Charge Type" value={chargeForm.chargeType} onChange={(value) => updateChargeField({ target: { name: 'chargeType', value } })} options={CHARGE_TYPES.map((purpose) => ({ value: purpose, label: purpose }))} />
              </label>

              <label>Amount
                <input name="amount" type="number" min="0.01" step="0.01" value={chargeForm.amount} onChange={updateChargeField} required />
              </label>

              <label className="payment-span-2">
                Final Due Date (Required)
                <DateField
                  ariaLabel="Final due date"
                  name="dueDate"
                  value={chargeForm.dueDate}
                  min={todayDateKey()}
                  onChange={(value) => updateChargeField({ target: { name: 'dueDate', value } })}
                  required
                />
                <small className="payment-homeowner-help">
                  The unpaid amount becomes overdue the day after this date (Manila time).
                </small>
              </label>

              {chargeProperty && chargePreviewAmount > 0 && (
  <div className="payment-balance-preview payment-span-2">
    <span>
      {chargeCreditUsed > 0
        ? `${peso.format(chargeCreditUsed)} of the homeowner's credit will be applied automatically. `
        : ''}
      {chargeBalanceAfter < 0
        ? 'Advance credit left after charge'
        : 'Balance owed after charge'}
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
              {chargesError ? <p className="payments-error" role="alert">{chargesError}</p> : chargesLoading && chargeRows.length === 0 ? (
                <div className="charge-list-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><Skeleton variant="rect" width="100%" height="44px" /><span className="skeleton-region-status" role="status">Loading</span></div>
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
                        {charge.due_date && <small>Final due date: {organization.formatDate(charge.due_date)} · Overdue from the next day if unpaid</small>}
                        {!charge.due_date && !charge.billing_month && <small>Legacy/system charge — no custom deadline recorded; existing aging rules apply</small>}
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

      {noteAmendmentTarget && (
        <ReceiptNoteAmendmentDialog
          payment={noteAmendmentTarget}
          onClose={() => setNoteAmendmentTarget(null)}
          onSaved={(note) => {
            setRows(current => current.map(row => row.id === noteAmendmentTarget.id ? { ...row, note } : row))
            setNoteAmendmentTarget(null)
          }}
        />
      )}
      {detailPayment && (
        <PaymentDetailDialog
          payment={detailPayment}
          formatDate={organization.formatDate}
          canVoid={canVoidPayments}
          onClose={() => setDetailPayment(null)}
          onVoid={() => voidFromDetail(detailPayment)}
          onAmend={() => { setNoteAmendmentTarget(detailPayment); setDetailPayment(null) }}
          onReceipt={() => openReceipt(detailPayment)}
        />
      )}

      {voidTarget && (() => {
        const isPayment = voidTarget.kind === 'payment'
        const item = voidTarget.item
        const homeowner = isPayment
          ? item.homeowner_name
          : propertyById.get(Number(item.property_id))?.homeowner_name || 'Homeowner'
        const amount = peso.format(Number(isPayment ? item.amount_paid : item.amount) || 0)
        const details = isPayment
          ? [
              ['Receipt', item.receipt_number],
              ['Homeowner', homeowner],
              ['Property', `${item.block_name} · Lot ${item.lot_number}`],
              ['Method', item.payment_method],
              ['Details', item.coverage_period, true],
            ]
          : [
              ['Charge', item.charge_type],
              ['Homeowner', homeowner],
            ]
        const quickReasons = isPayment
          ? ['Wrong amount typed', 'Wrong homeowner', 'Duplicate entry', 'Wrong payment method']
          : ['Charged by mistake', 'Wrong homeowner', 'Wrong amount']
        const reasonReady = voidReason.trim().length >= 5

        return (
          <div className="payments-overlay advance-overlay" onMouseDown={() => !voiding && setVoidTarget(null)}>
            <form
              className="advance-dialog void-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="void-title"
              onSubmit={confirmVoid}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="void-head">
                <div className="advance-icon void-icon" aria-hidden="true">!</div>
                <div>
                  <h2 id="void-title">{isPayment ? 'Void payment' : 'Void charge'}</h2>
                  <p>Check the details, then give a reason.</p>
                </div>
              </div>

              <dl className="void-summary">
                {details.map(([label, value, wide]) => (
                  <div key={label} className={wide ? 'is-wide' : ''}>
                    <dt>{label}</dt>
                    <dd>{value || '—'}</dd>
                  </div>
                ))}
                <div className="is-amount">
                  <dt>Amount</dt>
                  <dd>{amount}</dd>
                </div>
              </dl>

              <p className="void-callout">
                {isPayment
                  ? "The homeowner's balance is corrected automatically. This cannot be undone."
                  : "This removes the charge from the homeowner's balance. It does not cancel any payment — to undo a payment, use Void on the payment itself. This cannot be undone."}
              </p>

              <label className="void-reason" htmlFor="void-reason-input">
                <span>Reason <small>{voidReason.length} / 250</small></span>
                <textarea
                  id="void-reason-input"
                  value={voidReason}
                  onChange={(e) => { setVoidReason(e.target.value); setVoidError('') }}
                  rows="3"
                  maxLength="250"
                  placeholder="Tell us why this is being voided"
                  autoFocus
                />
              </label>
              <div className="void-quick" aria-label="Common reasons">
                {quickReasons.map((reason) => (
                  <button key={reason} type="button" onClick={() => { setVoidReason(reason); setVoidError('') }}>
                    {reason}
                  </button>
                ))}
              </div>

              {voidError && <p className="payments-error" role="alert">{voidError}</p>}
              <div className="advance-actions">
                <button type="button" className="payments-secondary" onClick={() => setVoidTarget(null)} disabled={voiding}>Cancel</button>
                <button type="submit" className="payments-primary void-confirm" disabled={voiding || !reasonReady}>
                  {voiding ? 'Voiding...' : isPayment ? 'Void payment' : 'Void charge'}
                </button>
              </div>
            </form>
          </div>
        )
      })()}

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

      <AnnualPromotionBalanceWarning
        balance={annualPromotionBalance}
        onClose={() => setAnnualPromotionBalance(null)}
      />
      <ActionDialog
        open={annualAdvancePrompt}
        title="12-month payment?"
        message="Does this Association Dues payment cover 12 months? Yes applies one month free. No lets you continue with a regular payment."
        confirmLabel="Yes, 12 months"
        cancelLabel="No, regular payment"
        onConfirm={() => chooseAnnualAdvance(true)}
        onCancel={() => chooseAnnualAdvance(false)}
      />

      {receipt && (() => {
        const receiptModel = buildReceiptModel('payment', receipt, organization, {
          advanceNote:
            Number(receipt.remaining_balance) < 0 && isBalanceReducingPurpose(receipt.charge_type)
              ? advanceCreditNote(-Number(receipt.remaining_balance), duesSettingsFor(receipt.property_id ?? form.propertyId))
              : '',
        })
        return (
          <ReceiptDialog
            model={receiptModel}
            onClose={() => setReceipt(null)}
            onPrint={(setup) => printReceipt(receiptModel, setPopupNotice, setup)}
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
        open={!!paymentSaveNotice}
        title={paymentSaveNotice?.title}
        message={paymentSaveNotice?.message}
        tone="danger"
        onConfirm={() => setPaymentSaveNotice(null)}
      />

      <ActionDialog
        open={!!popupNotice}
        title="Pop-up Blocked"
        message={popupNotice}
        onConfirm={() => setPopupNotice('')}
      />
    </div>
  )
}


function AnnualPromotionBalanceWarning({ balance, onClose }) {
  const overlayRef = useRef(null)
  const backRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const open = Number(balance) > 0

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    const siblings = [...document.body.children].filter((node) => node !== overlayRef.current)
    const inertStates = siblings.map((node) => [node, node.inert])
    siblings.forEach((node) => { node.inert = true })
    document.body.style.overflow = 'hidden'
    backRef.current?.focus()
    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = [...overlayRef.current.querySelectorAll('button')]
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !overlayRef.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !overlayRef.current.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('keydown', handleKey, true)
      inertStates.forEach(([node, inert]) => { node.inert = inert })
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="payment-promotion-overlay" ref={overlayRef} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="payment-promotion-dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="payment-promotion-title" aria-describedby="payment-promotion-description">
        <button type="button" className="payment-promotion-close" onClick={onClose} aria-label="Close promotion warning">×</button>
        <span className="payment-promotion-icon" aria-hidden="true">
          <svg width="31" height="31" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4m0 3h.01" />
          </svg>
        </span>
        <span className="payment-promotion-eyebrow">12-month dues promotion</span>
        <h2 id="payment-promotion-title">Clear the balance first</h2>
        <p id="payment-promotion-description" className="payment-promotion-description">This account has an outstanding balance. Settle it before applying the 12-month dues promotion with 1 month free.</p>
        <div className="payment-promotion-debt"><span>Outstanding balance</span><strong>{peso.format(Number(balance))}</strong></div>
        <p className="payment-promotion-next">Record a regular payment to clear existing dues, penalties, and other outstanding charges. Then start a separate eligible annual payment.</p>
        <button type="button" className="payment-promotion-back" ref={backRef} onClick={onClose}>Back to payment</button>
      </section>
    </div>, document.body
  )
}
