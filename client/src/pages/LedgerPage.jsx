import React, { useEffect, useMemo, useRef, useState } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle, Calendar, ChevronRight, RefreshCw } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { computeLateFee } from '../lib/latepenalty'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const date = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const MANILA_TIME_ZONE = 'Asia/Manila'
const MANILA_OFFSET = '+08:00'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TABLE_COLUMN_COUNT = 8

const selectedDateFormatter = new Intl.DateTimeFormat('en-PH', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const triggerDateFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

const normalize = (value) => String(value ?? '').trim().toLowerCase()

function dateKeyFromDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function dateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`)
}

function addDays(dateKey, amount) {
  const d = dateFromKey(dateKey)
  d.setUTCDate(d.getUTCDate() + amount)
  return d.toISOString().slice(0, 10)
}

function monthKeyFromDateKey(dateKey) {
  return dateKey.slice(0, 7)
}

function shiftMonth(monthKey, amount) {
  const [year, month] = monthKey.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1 + amount, 1))
  return d.toISOString().slice(0, 7)
}

function getCalendarDays(monthKey) {
  const firstDateKey = `${monthKey}-01`
  const firstDay = dateFromKey(firstDateKey).getUTCDay()
  const gridStart = addDays(firstDateKey, -firstDay)

  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

export default function LedgerPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [blocks, setBlocks] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [duesAmount, setDuesAmount] = useState(0)
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')

  const initialToday = dateKeyFromDate()
  const [todayKey, setTodayKey] = useState(initialToday)
  const [visibleMonth, setVisibleMonth] = useState(
    monthKeyFromDateKey(initialToday),
  )
  const [selectedDate, setSelectedDate] = useState(null)
  const [calendarOpen, setCalendarOpen] = useState(false)

  const calendarWrapRef = useRef(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageHomeowners = role === 'admin' || role === 'secretary'
  const actorName = currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadLedger()
    resolveCurrentUser()
  }, [])

  useEffect(() => {
    let midnightTimer

    function scheduleManilaDayChange() {
      const currentToday = dateKeyFromDate()
      const nextMidnight = new Date(
        `${addDays(currentToday, 1)}T00:00:00${MANILA_OFFSET}`,
      )
      const delay = Math.max(nextMidnight.getTime() - Date.now() + 1000, 1000)

      midnightTimer = window.setTimeout(() => {
        setTodayKey(dateKeyFromDate())
        scheduleManilaDayChange()
      }, delay)
    }

    scheduleManilaDayChange()
    return () => window.clearTimeout(midnightTimer)
  }, [])

  useEffect(() => {
    if (!calendarOpen) return undefined

    function handleClickOutside(event) {
      if (
        calendarWrapRef.current &&
        !calendarWrapRef.current.contains(event.target)
      ) {
        setCalendarOpen(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') setCalendarOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
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

  async function loadLedger(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setPageError('')

    const [blockResult, propertyResult, paymentResult, settingsResult] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name, created_at')
          .order('homeowner_name'),
        supabase.from('payments').select('*').order('paid_at', { ascending: false }),
        supabase.from('system_settings').select('dues_amount, due_day, grace_period_days, late_penalty').eq('id', 1).maybeSingle(),
      ])

    const errors = [blockResult.error, propertyResult.error, paymentResult.error]
      .filter(Boolean)
      .map((error) => error.message)

    if (errors.length > 0) {
      setPageError(`Could not load the complete ledger: ${errors.join(' ')}`)
    }

    setBlocks(blockResult.data || [])
    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setPenaltySettings({
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
    setRefreshing(false)
  }

  const ledgerEntries = useMemo(() => {
    return properties.map((property) => {
      const propertyPayments = payments.filter((payment) => {
        if (payment.property_id != null) {
          return Number(payment.property_id) === Number(property.id)
        }

        return (
          normalize(payment.homeowner_name) === normalize(property.homeowner_name) &&
          normalize(payment.block_name) === normalize(property.block) &&
          normalize(payment.lot_number).replace(/^lot\s*/, '') ===
            String(property.lot_number)
        )
      })

      const activePropertyPayments = propertyPayments.filter(
        (payment) => payment.status !== 'Voided',
      )
      const latestPayment = activePropertyPayments[0]
      const dueAmount = latestPayment
        ? Number(latestPayment.previous_balance) || duesAmount
        : duesAmount
      const paidAmount = latestPayment ? Number(latestPayment.amount_paid) || 0 : 0
      const balance = latestPayment
        ? Number(latestPayment.remaining_balance) || 0
        : dueAmount
      const lateFee = computeLateFee({
        balance,
        dueDay: penaltySettings.dueDay,
        gracePeriodDays: penaltySettings.gracePeriodDays,
        latePenalty: penaltySettings.latePenalty,
      })
      const status = balance <= 0
        ? 'Paid'
        : paidAmount > 0
          ? 'Partial'
          : lateFee.isOverdue
            ? 'Overdue'
            : 'Pending'

      return {
        id: property.id,
        name: property.homeowner_name,
        block: property.block,
        lot: `Lot ${property.lot_number}`,
        dueAmount,
        paidAmount,
        balance,
        penaltyAmount: lateFee.penaltyAmount,
        totalDue: lateFee.totalDue,
        lastPayment: latestPayment?.paid_at
          ? date.format(new Date(latestPayment.paid_at))
          : '—',
        lastPaymentDateKey: latestPayment?.paid_at
          ? dateKeyFromDate(new Date(latestPayment.paid_at))
          : null,
        paymentDateKeys: new Set(
          activePropertyPayments
            .filter((payment) => payment.paid_at)
            .map((payment) => dateKeyFromDate(new Date(payment.paid_at))),
        ),
        status,
      }
    })
  }, [properties, payments, duesAmount, penaltySettings])

  const calendarDays = useMemo(
    () => getCalendarDays(visibleMonth),
    [visibleMonth],
  )

  const paymentCountByDay = useMemo(() => {
    return payments.reduce((counts, payment) => {
      if (!payment.paid_at) return counts
      const key = dateKeyFromDate(new Date(payment.paid_at))
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {})
  }, [payments])

  const filtered = useMemo(() => {
    const term = normalize(search)
    return ledgerEntries.filter((entry) => {
      const matchesSearch =
        normalize(entry.name).includes(term) || normalize(entry.lot).includes(term)
      const matchesBlock = blockFilter === 'all' || entry.block === blockFilter
      const matchesStatus = statusFilter === 'all' || entry.status === statusFilter
      const matchesDate = !selectedDate || entry.paymentDateKeys.has(selectedDate)
      return matchesSearch && matchesBlock && matchesStatus && matchesDate
    })
  }, [ledgerEntries, search, blockFilter, statusFilter, selectedDate])

  const totals = useMemo(() => {
    return ledgerEntries.reduce(
      (result, entry) => ({
        totalDue: result.totalDue + entry.dueAmount,
        totalPaid: result.totalPaid + entry.paidAmount,
        totalBalance: result.totalBalance + entry.balance,
      }),
      { totalDue: 0, totalPaid: 0, totalBalance: 0 },
    )
  }, [ledgerEntries])

  const calendarTriggerLabel = selectedDate
    ? triggerDateFormatter.format(dateFromKey(selectedDate))
    : 'All dates'

  function selectDate(dateKey) {
    if (dateKey > todayKey) return
    setSelectedDate(dateKey)
    setVisibleMonth(monthKeyFromDateKey(dateKey))
    setCalendarOpen(false)
  }

  function changeMonth(amount) {
    const nextMonth = shiftMonth(visibleMonth, amount)
    const todayMonth = monthKeyFromDateKey(todayKey)
    if (nextMonth > todayMonth) return
    setVisibleMonth(nextMonth)
  }

  function goToToday() {
    selectDate(todayKey)
  }

  function clearDateFilter() {
    setSelectedDate(null)
    setCalendarOpen(false)
  }

  function toggleCalendar() {
    setCalendarOpen((current) => !current)
  }

  return (
    <div className="ledger-page">
      <div className="ledger-header-row">
        <div className="ledger-header">
          <h1>Ledger</h1>
        </div>

        <div className="ledger-header-actions">
          <div className="ledger-calendar-wrap" ref={calendarWrapRef}>
            <button
              type="button"
              className={`ledger-calendar-trigger ${calendarOpen ? 'is-open' : ''} ${selectedDate ? 'is-filtered' : ''}`}
              onClick={toggleCalendar}
              aria-haspopup="dialog"
              aria-expanded={calendarOpen}
            >
              <Calendar size={15} />
              {calendarTriggerLabel}
            </button>

            {calendarOpen && (
              <div className="ledger-calendar-popover" role="dialog" aria-label="Filter by payment date">
                <div className="ledger-calendar-heading">
                  <button
                    type="button"
                    className="ledger-calendar-arrow previous"
                    onClick={() => changeMonth(-1)}
                    aria-label="Previous month"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <strong>{monthFormatter.format(dateFromKey(`${visibleMonth}-01`))}</strong>
                  <button
                    type="button"
                    className="ledger-calendar-arrow"
                    onClick={() => changeMonth(1)}
                    disabled={visibleMonth >= monthKeyFromDateKey(todayKey)}
                    aria-label="Next month"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="ledger-calendar-weekdays" aria-hidden="true">
                  {WEEKDAYS.map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>

                <div className="ledger-calendar-grid">
                  {calendarDays.map((dateKey) => {
                    const count = paymentCountByDay[dateKey] || 0
                    const isOutsideMonth = monthKeyFromDateKey(dateKey) !== visibleMonth
                    const isFuture = dateKey > todayKey
                    const isToday = dateKey === todayKey
                    const isSelected = dateKey === selectedDate

                    return (
                      <button
                        key={dateKey}
                        type="button"
                        className={[
                          'ledger-calendar-day',
                          isOutsideMonth ? 'outside-month' : '',
                          isFuture ? 'future-day' : '',
                          isToday ? 'today' : '',
                          isSelected ? 'selected' : '',
                          count ? 'has-activity' : '',
                        ].filter(Boolean).join(' ')}
                        disabled={isFuture}
                        onClick={() => selectDate(dateKey)}
                        aria-label={`${selectedDateFormatter.format(dateFromKey(dateKey))}${count ? `, ${count} payments` : ', no payments'}`}
                        aria-current={isToday ? 'date' : undefined}
                      >
                        <span className="ledger-calendar-day-number">{Number(dateKey.slice(-2))}</span>
                        {count > 0 && <span className="ledger-calendar-count">{count}</span>}
                      </button>
                    )
                  })}
                </div>

                <div className="ledger-calendar-legend-row">
                  <div className="ledger-calendar-legend">
                    <span><i className="ledger-today-key" />Today</span>
                    <span><i className="ledger-activity-key" />Has payments</span>
                  </div>
                  <div className="ledger-calendar-quick-actions">
                    <button type="button" onClick={clearDateFilter} disabled={!selectedDate}>All dates</button>
                    <button type="button" onClick={goToToday} disabled={selectedDate === todayKey}>Jump to today</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="ledger-refresh-button"
            onClick={() => loadLedger(true)}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {pageError && (
        <p className="ledger-load-error" role="alert">
          {pageError}
        </p>
      )}

      <div className="ledger-summary-grid">
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-due"><FileText size={20} /></div>
          <div><p className="ledger-summary-label">Total Dues</p><p className="ledger-summary-value">{peso.format(totals.totalDue)}</p></div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-paid"><TrendingUp size={20} /></div>
          <div><p className="ledger-summary-label">Total Collected</p><p className="ledger-summary-value">{peso.format(totals.totalPaid)}</p></div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-balance"><AlertCircle size={20} /></div>
          <div><p className="ledger-summary-label">Outstanding Balance</p><p className="ledger-summary-value">{peso.format(totals.totalBalance)}</p></div>
        </div>
      </div>

      <div className="ledger-toolbar-card glass-card">
        <div className="ledger-toolbar">
          <div className="ledger-search-wrap">
            <input
              type="search"
              placeholder="Search by name or lot..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="ledger-search"
              aria-label="Search the ledger by homeowner name or lot"
            />
          </div>
          <select
            value={blockFilter}
            onChange={(event) => setBlockFilter(event.target.value)}
            className="ledger-select"
            disabled={loading}
            aria-label="Filter by block"
          >
            <option value="all">{loading ? 'Loading blocks...' : 'All Blocks'}</option>
            {blocks.map((block) => <option key={block.id} value={block.name}>{block.name}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="ledger-select"
            aria-label="Filter by payment status"
          >
            <option value="all">All Statuses</option>
            <option value="Paid">Paid</option>
            <option value="Partial">Partial</option>
            <option value="Pending">Pending</option>
            <option value="Overdue">Overdue</option>
          </select>
          <span className="ledger-result-count">
            {loading ? '—' : `${filtered.length} of ${ledgerEntries.length}`}
          </span>
        </div>

        {selectedDate && (
          <div className="ledger-filter-chip">
            <span>
              Showing homeowners whose last payment was on{' '}
              <strong>{selectedDateFormatter.format(dateFromKey(selectedDate))}</strong>
            </span>
            <button type="button" onClick={clearDateFilter}>Clear ×</button>
          </div>
        )}
      </div>

      <div className="ledger-table-wrap glass-card">
        <table className="ledger-table">
          <thead>
            <tr>
              <th scope="col">Homeowner</th>
              <th scope="col">Block / Lot</th>
              <th scope="col">Due</th>
              <th scope="col">Paid</th>
              <th scope="col">Balance</th>
              <th scope="col">Late Penalty</th>
              <th scope="col">Last Payment</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={TABLE_COLUMN_COUNT} className="ledger-empty">Loading ledger...</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMN_COUNT} className="ledger-empty">
                  {selectedDate
                    ? 'No homeowner had this as their last payment date.'
                    : 'No homeowner records found.'}
                </td>
              </tr>
            ) : filtered.map((entry) => (
              <tr key={entry.id} className={`ledger-row-${entry.status.toLowerCase()}`}>
                <td><strong>{entry.name}</strong></td>
                <td>{entry.block}, {entry.lot}</td>
                <td>{peso.format(entry.dueAmount)}</td>
                <td>{peso.format(entry.paidAmount)}</td>
                <td className={entry.balance > 0 ? 'ledger-balance-due' : ''}>{peso.format(entry.balance)}</td>
                <td className={entry.penaltyAmount > 0 ? 'ledger-balance-due' : ''}>
                  {entry.penaltyAmount > 0 ? peso.format(entry.penaltyAmount) : '—'}
                </td>
                <td>{entry.lastPayment}</td>
                <td><span className={`ledger-badge ledger-badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
