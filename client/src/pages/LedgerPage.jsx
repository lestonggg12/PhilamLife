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
const TABLE_COLUMN_COUNT = 9

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

const isMissingLedgerFoundation = (error) =>
  error?.code === '42P01' ||
  error?.code === 'PGRST205' ||
  normalize(error?.message).includes('homeowner_ledger_summary')

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
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [accountSummaries, setAccountSummaries] = useState(null)
  const [duesAmount, setDuesAmount] = useState(0)
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [postingAssessments, setPostingAssessments] = useState(false)
  const [statement, setStatement] = useState(null)
  const [statementLoading, setStatementLoading] = useState(false)

  const initialToday = dateKeyFromDate()
  const [todayKey, setTodayKey] = useState(initialToday)
  const [visibleMonth, setVisibleMonth] = useState(
    monthKeyFromDateKey(initialToday),
  )
  const [selectedDate, setSelectedDate] = useState(null)
  const [calendarOpen, setCalendarOpen] = useState(false)

  const calendarWrapRef = useRef(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageLedger = role === 'admin' || role === 'treasurer'

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

    const [
      blockResult,
      propertyResult,
      paymentResult,
      serviceTransactionResult,
      settingsResult,
      summaryResult,
    ] =
      await Promise.all([
        supabase.from('blocks').select('id, name').order('name'),
        supabase
          .from('properties')
          .select('id, block, lot_number, homeowner_name, created_at')
          .order('homeowner_name'),
        supabase.from('payments').select('*').order('paid_at', { ascending: false }),
        supabase
          .from('service_transactions')
          .select('*')
          .order('paid_at', { ascending: false }),
        supabase.from('system_settings').select('dues_amount, due_day, grace_period_days, late_penalty').eq('id', 1).maybeSingle(),
        supabase.from('homeowner_ledger_summary').select('*').order('homeowner_name'),
      ])

    const errors = [
      blockResult.error,
      propertyResult.error,
      paymentResult.error,
      serviceTransactionResult.error,
      settingsResult.error,
      isMissingLedgerFoundation(summaryResult.error) ? null : summaryResult.error,
    ]
      .filter(Boolean)
      .map((error) => error.message)

    if (errors.length > 0) {
      setPageError(`Could not load the complete ledger: ${errors.join(' ')}`)
    }

    setBlocks(blockResult.data || [])
    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setServiceTransactions(serviceTransactionResult.data || [])
    setAccountSummaries(summaryResult.error ? null : (summaryResult.data || []))
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
    const paymentDatesForProperty = (propertyId) => new Set(
      [...payments, ...serviceTransactions]
        .filter((record) =>
          Number(record.property_id) === Number(propertyId) &&
          normalize(record.status) !== 'voided' &&
          normalize(record.payment_status) !== 'voided' &&
          record.paid_at,
        )
        .map((record) => dateKeyFromDate(new Date(record.paid_at))),
    )

    if (accountSummaries) {
      return accountSummaries.map((summary) => ({
        id: summary.property_id,
        name: summary.homeowner_name,
        block: summary.block,
        lot: `Lot ${summary.lot_number}`,
        dueAmount: Number(summary.total_assessed) || 0,
        paidAmount: Number(summary.total_collected) || 0,
        balance: Number(summary.outstanding_balance) || 0,
        penaltyAmount: Number(summary.penalty_charges) || 0,
        totalDue: Number(summary.outstanding_balance) || 0,
        duesCollected: Number(summary.dues_collected) || 0,
        serviceCollected: Number(summary.service_collected) || 0,
        agingCurrent: Number(summary.aging_current) || 0,
        aging1To30: Number(summary.aging_1_30) || 0,
        aging31To60: Number(summary.aging_31_60) || 0,
        aging61To90: Number(summary.aging_61_90) || 0,
        aging90Plus: Number(summary.aging_90_plus) || 0,
        lastPayment: summary.last_payment_at
          ? date.format(new Date(summary.last_payment_at))
          : '—',
        paymentDateKeys: paymentDatesForProperty(summary.property_id),
        status: summary.account_status || 'Pending',
        foundationMode: true,
      }))
    }

    return properties.map((property) => {
      const matchesProperty = (record) => {
        if (record.property_id != null) {
          return Number(record.property_id) === Number(property.id)
        }

        return (
          normalize(record.block_name) === normalize(property.block) &&
          normalize(record.lot_number).replace(/^lot\s*/, '') ===
            normalize(property.lot_number).replace(/^lot\s*/, '')
        )
      }

      const propertyPayments = payments.filter((payment) => {
        if (!matchesProperty(payment)) return false

        // Keep the homeowner-name check for legacy dues rows that have no
        // property_id, but do not require it for service transactions because
        // those rows are linked by block + lot in the current schema.
        return payment.property_id != null ||
          normalize(payment.homeowner_name) === normalize(property.homeowner_name)
      })

      const activePropertyPayments = propertyPayments.filter(
        (payment) => normalize(payment.status) !== 'voided',
      )
      const activeServiceTransactions = serviceTransactions.filter(
        (transaction) =>
          matchesProperty(transaction) &&
          normalize(transaction.status) !== 'voided' &&
          normalize(transaction.payment_status) !== 'voided',
      )
      const latestPayment = activePropertyPayments[0]
      const dueAmount = latestPayment
        ? Number(latestPayment.previous_balance) || duesAmount
        : duesAmount
      const duesCollected = activePropertyPayments.reduce(
        (sum, payment) => sum + (Number(payment.amount_paid) || 0),
        0,
      )
      const serviceCollected = activeServiceTransactions.reduce(
        (sum, transaction) => sum + (Number(transaction.amount_paid) || 0),
        0,
      )
      const paidAmount = duesCollected + serviceCollected
      const latestCollection = [
        ...activePropertyPayments,
        ...activeServiceTransactions,
      ]
        .filter((record) => record.paid_at)
        .sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at))[0]
      const currentDuesPaid = latestPayment
        ? Number(latestPayment.amount_paid) || 0
        : 0
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
        : currentDuesPaid > 0
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
        duesCollected,
        serviceCollected,
        agingCurrent: balance,
        aging1To30: 0,
        aging31To60: 0,
        aging61To90: 0,
        aging90Plus: 0,
        lastPayment: latestCollection?.paid_at
          ? date.format(new Date(latestCollection.paid_at))
          : '—',
        paymentDateKeys: new Set(
          [...activePropertyPayments, ...activeServiceTransactions]
            .filter((record) => record.paid_at)
            .map((record) => dateKeyFromDate(new Date(record.paid_at))),
        ),
        status,
      }
    })
  }, [accountSummaries, properties, payments, serviceTransactions, duesAmount, penaltySettings])

  const calendarDays = useMemo(
    () => getCalendarDays(visibleMonth),
    [visibleMonth],
  )

  const paymentCountByDay = useMemo(() => {
    const activeCollections = [...payments, ...serviceTransactions].filter(
      (record) =>
        normalize(record.status) !== 'voided' &&
        normalize(record.payment_status) !== 'voided',
    )

    return activeCollections.reduce((counts, record) => {
      if (!record.paid_at) return counts
      const key = dateKeyFromDate(new Date(record.paid_at))
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {})
  }, [payments, serviceTransactions])

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
    return filtered.reduce(
      (result, entry) => ({
        totalDue: result.totalDue + entry.dueAmount,
        totalPaid: result.totalPaid + entry.paidAmount,
        totalDuesCollected: result.totalDuesCollected + entry.duesCollected,
        totalServiceCollected:
          result.totalServiceCollected + entry.serviceCollected,
        totalBalance: result.totalBalance + entry.balance,
      }),
      {
        totalDue: 0,
        totalPaid: 0,
        totalDuesCollected: 0,
        totalServiceCollected: 0,
        totalBalance: 0,
      },
    )
  }, [filtered])

  const agingTotals = useMemo(() => filtered.reduce(
    (result, entry) => ({
      current: result.current + entry.agingCurrent,
      days1To30: result.days1To30 + entry.aging1To30,
      days31To60: result.days31To60 + entry.aging31To60,
      days61To90: result.days61To90 + entry.aging61To90,
      days90Plus: result.days90Plus + entry.aging90Plus,
    }),
    { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days90Plus: 0 },
  ), [filtered])

  async function postMonthlyDues() {
    if (!canManageLedger || postingAssessments) return
    if (!window.confirm('Post this month’s approved assessments to all current properties?')) return

    setPostingAssessments(true)
    setPageError('')
    const { data, error } = await supabase.rpc('post_monthly_assessments')
    if (error) {
      setPageError(`Could not post monthly assessments: ${error.message}`)
    } else {
      await loadLedger(true)
      window.alert(`${Number(data) || 0} assessment(s) posted. Existing charges were not duplicated.`)
    }
    setPostingAssessments(false)
  }

  async function openStatement(entry) {
    setStatement({ entry, lines: [], error: '' })
    setStatementLoading(true)
    const { data: lines, error } = await supabase
      .from('homeowner_statement_lines')
      .select('*')
      .eq('property_id', entry.id)
      .order('occurred_at', { ascending: true })

    setStatement({
      entry,
      lines: lines || [],
      error: error ? error.message : '',
    })
    setStatementLoading(false)
  }

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
          <div className="ledger-header-icon" aria-hidden="true">
            <FileText size={24} />
          </div>
          <div className="ledger-header-copy">
            <span className="ledger-header-eyebrow">Financial Records</span>
            <h1>Homeowner Ledger</h1>
            <p>Track dues, amenity collections, balances, and payment activity.</p>
          </div>
        </div>

        <div className="ledger-header-actions">
          {canManageLedger && accountSummaries && (
            <button
              type="button"
              className="ledger-save-button"
              onClick={postMonthlyDues}
              disabled={postingAssessments || refreshing}
            >
              {postingAssessments ? 'Posting...' : 'Post Monthly Dues'}
            </button>
          )}
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

      {!loading && !accountSummaries && (
        <p className="ledger-foundation-notice" role="status">
          Legacy summary mode is active. Apply the HOA ledger foundation migration
          before relying on charge history, aging, allocations, or statements.
        </p>
      )}

      <div className="ledger-summary-grid">
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-due"><FileText size={20} /></div>
          <div><p className="ledger-summary-label">Total Dues</p><p className="ledger-summary-value">{peso.format(totals.totalDue)}</p></div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-paid"><TrendingUp size={20} /></div>
          <div>
            <p className="ledger-summary-label">Total Collected</p>
            <p className="ledger-summary-value">{peso.format(totals.totalPaid)}</p>
            <p className="ledger-summary-detail">
              Dues {peso.format(totals.totalDuesCollected)} · Amenities {peso.format(totals.totalServiceCollected)}
            </p>
          </div>
        </div>
        <div className="ledger-summary-card glass-card">
          <div className="ledger-summary-icon ledger-summary-icon-balance"><AlertCircle size={20} /></div>
          <div><p className="ledger-summary-label">Outstanding Balance</p><p className="ledger-summary-value">{peso.format(totals.totalBalance)}</p></div>
        </div>
      </div>

      {accountSummaries && (
        <section className="ledger-aging-card glass-card" aria-labelledby="ledger-aging-title">
          <div>
            <span className="ledger-header-eyebrow">Accounts Receivable Aging</span>
            <h2 id="ledger-aging-title">Outstanding by age</h2>
          </div>
          <div className="ledger-aging-grid">
            <div><span>Current</span><strong>{peso.format(agingTotals.current)}</strong></div>
            <div><span>1–30 days</span><strong>{peso.format(agingTotals.days1To30)}</strong></div>
            <div><span>31–60 days</span><strong>{peso.format(agingTotals.days31To60)}</strong></div>
            <div><span>61–90 days</span><strong>{peso.format(agingTotals.days61To90)}</strong></div>
            <div><span>90+ days</span><strong>{peso.format(agingTotals.days90Plus)}</strong></div>
          </div>
        </section>
      )}

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
              Showing homeowners with payment activity on{' '}
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
              <th scope="col">Collected</th>
              <th scope="col">Balance</th>
              <th scope="col">Late Penalty</th>
              <th scope="col">Last Payment</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={TABLE_COLUMN_COUNT} className="ledger-empty">Loading ledger...</td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMN_COUNT} className="ledger-empty">
                  {selectedDate
                    ? 'No homeowner had payment activity on this date.'
                    : 'No homeowner records found.'}
                </td>
              </tr>
            ) : filtered.map((entry) => (
              <tr key={entry.id} className={`ledger-row-${entry.status.toLowerCase()}`}>
                <td><strong>{entry.name}</strong></td>
                <td>{entry.block}, {entry.lot}</td>
                <td>{peso.format(entry.dueAmount)}</td>
                <td>
                  <strong>{peso.format(entry.paidAmount)}</strong>
                  {entry.serviceCollected > 0 && (
                    <span className="ledger-payment-breakdown">
                      Dues {peso.format(entry.duesCollected)} · Amenities {peso.format(entry.serviceCollected)}
                    </span>
                  )}
                </td>
                <td className={entry.balance > 0 ? 'ledger-balance-due' : ''}>{peso.format(entry.balance)}</td>
                <td className={entry.penaltyAmount > 0 ? 'ledger-balance-due' : ''}>
                  {entry.penaltyAmount > 0 ? peso.format(entry.penaltyAmount) : '—'}
                </td>
                <td>{entry.lastPayment}</td>
                <td><span className={`ledger-badge ledger-badge-${entry.status.toLowerCase()}`}>{entry.status}</span></td>
                <td>
                  <button
                    type="button"
                    className="ledger-statement-button"
                    onClick={() => openStatement(entry)}
                    disabled={!accountSummaries}
                  >
                    Statement
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statement && (
        <div className="ledger-modal-backdrop" onMouseDown={() => setStatement(null)}>
          <section
            className="ledger-modal ledger-statement-modal glass-card"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-statement-title"
          >
            <div className="ledger-modal-heading">
              <div>
                <span className="ledger-header-eyebrow">Statement of Account</span>
                <h2 id="ledger-statement-title">{statement.entry.name}</h2>
                <p>{statement.entry.block}, {statement.entry.lot}</p>
              </div>
              <button type="button" className="ledger-modal-close" onClick={() => setStatement(null)}>×</button>
            </div>

            {statementLoading ? (
              <p className="ledger-empty">Loading statement...</p>
            ) : statement.error ? (
              <p className="ledger-load-error">{statement.error}</p>
            ) : statement.lines.length === 0 ? (
              <p className="ledger-empty">No posted ledger transactions yet.</p>
            ) : (
              <div className="ledger-statement-table-wrap">
                <table className="ledger-table ledger-statement-table">
                  <thead>
                    <tr><th>Date</th><th>Description</th><th>Reference</th><th>Debit</th><th>Credit</th></tr>
                  </thead>
                  <tbody>
                    {statement.lines.map((line) => (
                      <tr key={`${line.entry_type}-${line.source_id}`}>
                        <td>{date.format(new Date(line.occurred_at))}</td>
                        <td>{line.description}</td>
                        <td>{line.reference || '—'}</td>
                        <td>{Number(line.debit) > 0 ? peso.format(line.debit) : '—'}</td>
                        <td>{Number(line.credit) > 0 ? peso.format(line.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="ledger-statement-total">
              <span>Current outstanding balance</span>
              <strong>{peso.format(statement.entry.balance)}</strong>
            </div>
            <div className="ledger-modal-actions">
              <button type="button" className="ledger-cancel-button" onClick={() => setStatement(null)}>Close</button>
              <button type="button" className="ledger-save-button" onClick={() => window.print()}>Print / Save PDF</button>
            </div>
          </section>
        </div>
      )}

    </div>
  )
}