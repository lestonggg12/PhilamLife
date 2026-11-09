import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Calendar, Mail, Phone, RefreshCw, Search, Users } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { describeOverdueAccount, summarizeOverdueAccounts, verifyOverdueSnapshot } from '../lib/overdueAccounts'
import { fetchAll } from '../lib/fetchAll'
import { useOrganization } from '../context/OrganizationContext'
import './OverdueAccountsPage.css'
import { Pager } from '../components/PagerControls'
import { useListPage, matchesHomeownerSearch } from '../lib/homeownerDirectory'
import Skeleton from '../components/skeleton/Skeleton'

const STATUS_FILTERS = ['Overdue', 'Pending', 'Partial', 'Paid', 'Review', 'All']

const AGING_TIERS = ['1-30 days', '31-60 days', '61-90 days', '90+ days']

const ACTION_TYPES = ['Phone Call', 'Email Sent', 'Formal Notice', 'Payment Plan Arranged', 'Site Visit', 'Other']

function agingTierOf(daysOverdue) {
  if (daysOverdue <= 30) return '1-30 days'
  if (daysOverdue <= 60) return '31-60 days'
  if (daysOverdue <= 90) return '61-90 days'
  return '90+ days'
}

const SORTS = [
  { value: 'days', label: 'Most days overdue' },
  { value: 'balance', label: 'Highest balance' },
  { value: 'name', label: 'Name A–Z' },
]

const initialsOf = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || '?'

const tierIndexOf = (tier) => AGING_TIERS.indexOf(tier)

// Centered account pop-up: facts, contact, log form and history in one place,
// with Previous / Next to move through the filtered list.
function AccountDialog({
  account,
  position,
  total,
  form,
  setForm,
  saving,
  error,
  canLog,
  focusForm,
  formatMoney,
  formatDate,
  onSubmit,
  onClose,
  onStep,
  onOpenProfile,
}) {
  const dialogRef = useRef(null)
  const detailsRef = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    document.documentElement.style.overflow = 'hidden'
    ;(focusForm ? detailsRef.current : dialogRef.current)?.focus({ preventScroll: true })
    return () => {
      document.documentElement.style.overflow = ''
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleKeys(event) {
    const typing = /^(TEXTAREA|INPUT)$/.test(document.activeElement?.tagName)
    if (event.key === 'Escape' && !saving) {
      event.preventDefault()
      onClose()
    } else if (!typing && event.key === 'ArrowLeft') {
      event.preventDefault()
      onStep(-1)
    } else if (!typing && event.key === 'ArrowRight') {
      event.preventDefault()
      onStep(1)
    } else if (event.key === 'Tab') {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled), a[href], textarea, input')]
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

  const overdue = account.status === 'Overdue'

  return createPortal(
    <div
      className="od-layer"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="od-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        tabIndex={-1}
        onKeyDown={handleKeys}
      >
        <div className="od-d-head">
          <span className="od-avatar" aria-hidden="true">
            {initialsOf(account.name)}
          </span>
          <div>
            <h2 id="account-dialog-title">{account.name}</h2>
            <p>
              {account.block}, {account.lot} ·{' '}
              <span className={`od-pill ${account.status.toLowerCase()}`}>{account.status}</span>
            </p>
          </div>
          <button type="button" className="od-d-close" onClick={onClose} disabled={saving} aria-label="Close">
            ×
          </button>
        </div>

        <div className="od-d-body">
          <dl className="od-facts">
            <div className="od-fact">
              <dt>Balance</dt>
              <dd>{formatMoney(account.balance)}</dd>
            </div>
            <div className="od-fact">
              <dt>Past due</dt>
              <dd className={account.overdueAmount > 0 ? 'red' : ''}>{formatMoney(account.overdueAmount)}</dd>
            </div>
            <div className="od-fact">
              <dt>Days overdue</dt>
              <dd>{overdue ? Number(account.daysOverdue).toLocaleString() : '—'}</dd>
            </div>
            <div className="od-fact">
              <dt>Last payment</dt>
              <dd>{account.lastPaymentAt ? formatDate(account.lastPaymentAt) : 'None yet'}</dd>
            </div>
          </dl>

          <div className="od-d-section">
            <h3>Contact</h3>
            <div className="od-row-actions od-left">
              {account.phone && (
                <a className="od-row-btn" href={`tel:${account.phone}`}>
                  <Phone size={14} /> {account.phone}
                </a>
              )}
              {account.email && (
                <a className="od-row-btn" href={`mailto:${account.email}`}>
                  <Mail size={14} /> {account.email}
                </a>
              )}
              {!account.phone && !account.email && <span className="od-muted">No contact details on file.</span>}
              <button type="button" className="od-row-btn" onClick={onOpenProfile}>
                Open homeowner profile →
              </button>
            </div>
          </div>

          {canLog && (
            <form className="od-d-section" onSubmit={onSubmit} noValidate>
              <h3>Log a collection action</h3>
              <div className="od-types" role="group" aria-label="Action type">
                {ACTION_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={form.action_type === type}
                    disabled={saving}
                    onClick={() => setForm((current) => ({ ...current, action_type: type }))}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <label className="od-field">
                Details
                <textarea
                  ref={detailsRef}
                  rows={3}
                  value={form.details}
                  onChange={(e) => setForm((current) => ({ ...current, details: e.target.value }))}
                  placeholder="What happened, what was agreed, next steps..."
                  disabled={saving}
                />
              </label>
              <label className="od-field">
                Document reference (optional)
                <input
                  type="text"
                  value={form.document_reference}
                  onChange={(e) => setForm((current) => ({ ...current, document_reference: e.target.value }))}
                  placeholder="Notice #, letter reference, etc."
                  disabled={saving}
                />
              </label>
              {error && <p className="od-form-error">{error}</p>}
              <div className="od-form-foot">
                <button type="submit" className="od-btn primary" disabled={saving || form.details.trim().length < 3}>
                  {saving ? 'Saving...' : 'Save action'}
                </button>
              </div>
            </form>
          )}

          <div className="od-d-section">
            <h3>
              History <span>{account.actionCount} logged</span>
            </h3>
            {account.actions.length === 0 ? (
              <p className="od-muted">No actions logged yet.</p>
            ) : (
              <ol className="od-timeline">
                {account.actions.map((action) => (
                  <li key={action.id}>
                    <div className="od-t-head">
                      <strong>{action.action_type}</strong>
                      <span>{formatDate(action.action_date, { withTime: true })}</span>
                    </div>
                    <p>{action.details}</p>
                    {action.document_reference && <small>Ref: {action.document_reference}</small>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="od-d-foot">
          <button type="button" className="od-btn" onClick={() => onStep(-1)} disabled={position === 0 || saving}>
            ‹ Previous
          </button>
          <span className="od-count">
            {position + 1} of {total}
            <br />
            <small>← → to browse · Esc to close</small>
          </span>
          <button
            type="button"
            className="od-btn"
            onClick={() => onStep(1)}
            disabled={position === total - 1 || saving}
          >
            Next ›
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

// Age the actual UNPAID balance items from property_overdue_summary, not raw
// payments or a hypothetical penalty. Pending penalties must never be shown
// as posted debt; the database posts actual penalties separately.
export default function OverdueAccountsPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [properties, setProperties] = useState([])
  const [paymentSummaries, setPaymentSummaries] = useState([])
  const [collectionActions, setCollectionActions] = useState([])
  const [actionsLoading, setActionsLoading] = useState(false)
  const [actionsError, setActionsError] = useState('')
  const [actionsReload, setActionsReload] = useState(0)
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [dataAvailable, setDataAvailable] = useState(false)
  const loadSequence = useRef(0)
  const logSubmitting = useRef(false)
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('All')
  const [overdueSummaries, setOverdueSummaries] = useState([])
  const [statusFilter, setStatusFilter] = useState('Overdue')
  const [agingFilter, setAgingFilter] = useState('All')
  const [detailId, setDetailId] = useState(null)
  const [focusForm, setFocusForm] = useState(false)
  const [sortKey, setSortKey] = useState('days')
  const [logForm, setLogForm] = useState({ action_type: ACTION_TYPES[0], details: '', document_reference: '' })
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState('')

  useEffect(() => {
    loadData()
    resolveCurrentUser()
  }, [])

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
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', authUser.id)
      .single()
    if (!profileError) setCurrentUser(profile)
  }

  async function loadData(isRefresh = false) {
    const sequence = ++loadSequence.current
    isRefresh ? setRefreshing(true) : setLoading(true)
    setPageError('')
    try {
      const [propertyResult, paymentResult, settingsResult, overdueResult] = await Promise.all([
        fetchAll(() =>
          supabase
            .from('properties')
            .select(
              'id, homeowner_name, block, lot_number, contact_phone, contact_email, homeowner_status, current_balance',
            ),
        ),
        // One small row per homeowner (latest payment) computed by the database.
        fetchAll(
          () =>
            supabase
              .from('property_payment_summary')
              .select('property_id, latest_paid_at, latest_amount_paid')
              .order('property_id'),
          { tiebreaker: null },
        ),
        supabase.from('system_settings').select('due_day, grace_period_days, late_penalty').eq('id', 1).maybeSingle(),
        fetchAll(
          () =>
            supabase
              .from('property_overdue_summary')
              .select(
                'property_id, balance, overdue_amount, is_overdue, days_overdue, aging_complete, aging_date_fallback_count',
              )
              .order('property_id'),
          { tiebreaker: null },
        ),
      ])
      if (sequence !== loadSequence.current) return
      const errors = [propertyResult.error, paymentResult.error, settingsResult.error, overdueResult.error].filter(
        Boolean,
      )
      if (errors.length) throw new Error(errors.map((error) => error.message).join(' '))
      verifyOverdueSnapshot(propertyResult.data, paymentResult.data, settingsResult.data, overdueResult.data)

      const unaged = overdueResult.data.filter((row) => row.aging_complete === false)
      if (unaged.length)
        setPageError(
          `${unaged.length} account(s) have unreconciled aging data. Their overdue classification requires review.`,
        )
      setProperties(propertyResult.data)
      setPaymentSummaries(paymentResult.data)
      setOverdueSummaries(overdueResult.data)
      setPenaltySettings({
        dueDay: Number(settingsResult.data.due_day),
        gracePeriodDays: Number(settingsResult.data.grace_period_days),
        latePenalty: Number(settingsResult.data.late_penalty) || 0,
      })
      setDataAvailable(true)
      setActionsReload((value) => value + 1)
    } catch (error) {
      if (sequence === loadSequence.current) {
        // Preserve a previously verified snapshot, never replace it with partial results.
        setPageError(`Unable to load complete overdue data: ${error.message || 'Connection failed.'}`)
      }
    } finally {
      if (sequence === loadSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  const actionsByProperty = useMemo(() => {
    const map = new Map()
    collectionActions.forEach((action) => {
      const list = map.get(action.property_id) || []
      list.push(action)
      map.set(action.property_id, list)
    })
    return map
  }, [collectionActions])

  const summaryByProperty = useMemo(
    () => new Map(paymentSummaries.map((row) => [Number(row.property_id), row])),
    [paymentSummaries],
  )

  const overdueByProperty = useMemo(
    () => new Map(overdueSummaries.map((row) => [Number(row.property_id), row])),
    [overdueSummaries],
  )

  const accounts = useMemo(() => {
    return properties
      .filter((property) => (property.homeowner_status || 'active') === 'active')
      .map((property) => {
        const latestPayment = summaryByProperty.get(Number(property.id))
        const aging = overdueByProperty.get(Number(property.id))
        // No summary is not the same as a zero balance.
        const classified = describeOverdueAccount(property, aging, latestPayment)

        const propertyActions = actionsByProperty.get(property.id) || []
        const lastAction = propertyActions[0] || null

        return {
          ...classified,
          id: property.id,
          name: property.homeowner_name,
          block: property.block,
          lot: `Lot ${property.lot_number}`,
          phone: property.contact_phone || '',
          email: property.contact_email || '',
          lastPaymentAt: latestPayment?.latest_paid_at || null,
          lastAction,
          actionCount: propertyActions.length,
          actions: propertyActions,
        }
      })
  }, [properties, summaryByProperty, overdueByProperty, actionsByProperty])

  const blocks = useMemo(
    () => ['All', ...new Set(properties.map((property) => property.block).filter(Boolean))].sort(),
    [properties],
  )

  const filtered = useMemo(() => {
    return accounts
      .filter((a) => statusFilter === 'All' || a.status === statusFilter)
      .filter((a) => agingFilter === 'All' || a.agingTier === agingFilter)
      .filter((a) => blockFilter === 'All' || a.block === blockFilter)
      .filter((a) => matchesHomeownerSearch({ homeowner_name: a.name, block: a.block, lot_number: a.lot }, search))
      .sort((a, b) => {
        if (sortKey === 'balance') return b.balance - a.balance || b.daysOverdue - a.daysOverdue || a.id - b.id
        if (sortKey === 'name') return String(a.name).localeCompare(String(b.name)) || a.id - b.id
        return b.daysOverdue - a.daysOverdue || b.balance - a.balance || a.id - b.id
      })
  }, [accounts, search, blockFilter, statusFilter, agingFilter, sortKey])

  // Tab counts follow the search and block filters, so each tab shows what it would list.
  const statusCounts = useMemo(() => {
    const counts = { All: 0 }
    accounts
      .filter((a) => blockFilter === 'All' || a.block === blockFilter)
      .filter((a) => matchesHomeownerSearch({ homeowner_name: a.name, block: a.block, lot_number: a.lot }, search))
      .forEach((a) => {
        counts.All += 1
        counts[a.status] = (counts[a.status] || 0) + 1
      })
    return counts
  }, [accounts, search, blockFilter])
  const hasFilters = Boolean(search.trim()) || blockFilter !== 'All' || agingFilter !== 'All'
  function clearFilters() {
    setSearch('')
    setBlockFilter('All')
    setAgingFilter('All')
  }

  const accountPage = useListPage(filtered, [search, blockFilter, statusFilter, agingFilter])

  const visibleIds = JSON.stringify(accountPage.rows.map((account) => account.id))
  useEffect(() => {
    if (loading) return undefined
    let cancelled = false
    const ids = JSON.parse(visibleIds)
    setCollectionActions([])
    setActionsError('')
    if (!ids.length) {
      setActionsLoading(false)
      return undefined
    }
    setActionsLoading(true)
    async function loadVisibleActions() {
      try {
        const { data, error } = await fetchAll(() =>
          supabase
            .from('collection_actions')
            .select('id, property_id, action_type, action_date, details, document_reference, created_by')
            .in('property_id', ids)
            .order('action_date', { ascending: false }),
        )
        if (error) throw error
        if (!Array.isArray(data)) throw new Error('Incomplete follow-up history response.')
        if (!cancelled) setCollectionActions(data)
      } catch (error) {
        if (!cancelled) {
          setCollectionActions([])
          setActionsError(`Follow-up history could not be loaded: ${error.message || 'Connection failed.'}`)
        }
      } finally {
        if (!cancelled) setActionsLoading(false)
      }
    }
    loadVisibleActions()
    return () => {
      cancelled = true
    }
  }, [visibleIds, loading, actionsReload])

  const summary = useMemo(() => {
    return summarizeOverdueAccounts(accounts)
  }, [accounts])

  const filteredSummary = useMemo(() => summarizeOverdueAccounts(filtered), [filtered])

  const detail = detailId === null ? null : accounts.find((account) => account.id === detailId) || null
  const detailIds = accountPage.rows.map((account) => account.id)
  const detailPosition = detail ? detailIds.indexOf(detail.id) : -1

  function resetLogForm() {
    setLogForm({ action_type: ACTION_TYPES[0], details: '', document_reference: '' })
    setLogError('')
  }

  function openAccount(account, withForm = false) {
    resetLogForm()
    setFocusForm(withForm)
    setDetailId(account.id)
  }

  function closeAccount() {
    if (logSaving) return
    setDetailId(null)
  }

  function stepAccount(direction) {
    const nextId = detailIds[detailPosition + direction]
    if (nextId === undefined) return
    resetLogForm()
    setFocusForm(false)
    setDetailId(nextId)
  }

  async function submitLogAction(event) {
    event.preventDefault()
    if (logSubmitting.current) return
    if (!detail || !currentUser?.id) {
      setLogError('Unable to identify the current user. Please refresh and try again.')
      return
    }
    if (!logForm.details.trim()) {
      setLogError('Add a short note about what happened.')
      return
    }

    logSubmitting.current = true
    setLogSaving(true)
    setLogError('')
    try {
      const { data, error } = await supabase
        .from('collection_actions')
        .insert({
          property_id: detail.id,
          action_type: logForm.action_type,
          details: logForm.details.trim(),
          document_reference: logForm.document_reference.trim() || null,
          created_by: currentUser.id,
        })
        .select('id, property_id, action_type, action_date, details, document_reference, created_by')
        .single()
      if (error) throw error
      if (!data?.id || Number(data.property_id) !== Number(detail.id)) {
        throw new Error('The follow-up save could not be confirmed. Refresh before retrying.')
      }
      setCollectionActions((current) => [data, ...current])
      setActionsReload((value) => value + 1)
      notifySuccess(`${logForm.action_type} follow-up saved for ${detail.name || 'this homeowner'}.`)
      resetLogForm()
    } catch (error) {
      setLogError(
        `${error.message || 'The follow-up could not be saved.'} If the connection was interrupted, refresh the history before retrying.`,
      )
    } finally {
      logSubmitting.current = false
      setLogSaving(false)
    }
  }

  const maxTierBalance = Math.max(1, ...AGING_TIERS.map((t) => summary.byTier[t].balance))
  const kpiValue = (loading_, node, width) =>
    loading_ ? <Skeleton variant="rect" width={width} height="1.2em" /> : !dataAvailable ? 'Unavailable' : node

  return (
    <div className="overdue-page">
      <header className="od-header">
        <div>
          <p className="od-eyebrow">Collections</p>
          <h1>Overdue Accounts</h1>
          <p>
            Homeowners past Due Day {penaltySettings.dueDay} (+{penaltySettings.gracePeriodDays}-day grace period),
            based on outstanding balance items. Only posted penalties are included in balances.
          </p>
        </div>
        <button type="button" className="od-btn" onClick={() => loadData(true)} disabled={refreshing}>
          <RefreshCw size={16} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <section className="od-kpis" aria-label="Overdue account summaries" aria-busy={loading || refreshing}>
        <article className="od-kpi">
          <div className="od-kpi-top">
            <span className="od-kpi-label">Matching accounts</span>
            <span className="od-kpi-icon red">
              <Users size={18} />
            </span>
          </div>
          <strong className="red">{kpiValue(loading, filtered.length, '42px')}</strong>
          <small>of {accounts.length} lots</small>
        </article>
        <article className="od-kpi">
          <div className="od-kpi-top">
            <span className="od-kpi-label">Overdue balance</span>
            <span className="od-kpi-icon red">
              <AlertCircle size={18} />
            </span>
          </div>
          <strong>{kpiValue(loading, organization.formatMoney(filteredSummary.overdueBalance), '86px')}</strong>
          <small>Total outstanding</small>
        </article>
        <article className="od-kpi">
          <div className="od-kpi-top">
            <span className="od-kpi-label">Current portion</span>
            <span className="od-kpi-icon blue">
              <Calendar size={18} />
            </span>
          </div>
          <strong>{kpiValue(loading, organization.formatMoney(filteredSummary.currentPortion), '86px')}</strong>
          <small>Not yet past due</small>
        </article>
        <article className="od-kpi">
          <div className="od-kpi-top">
            <span className="od-kpi-label">Follow-ups logged</span>
            <span className="od-kpi-icon green">
              <Phone size={18} />
            </span>
          </div>
          <strong>
            {kpiValue(
              loading,
              filtered.reduce((total, account) => total + account.actionCount, 0),
              '42px',
            )}
          </strong>
          <small>Calls, notices and visits</small>
        </article>
      </section>

      {!loading && summary.overdueCount > 0 && (
        <section className="od-tiers" aria-label="Filter by how late">
          {AGING_TIERS.map((tier, index) => (
            <button
              key={tier}
              type="button"
              className={`od-tier ${index === 3 ? 'severe' : ''}`}
              aria-pressed={agingFilter === tier}
              onClick={() => setAgingFilter(agingFilter === tier ? 'All' : tier)}
            >
              <div className="od-tier-top">
                <span className="od-tier-name">{tier}</span>
                <span className="od-tier-tag">{agingFilter === tier ? 'Filtering' : 'Click to filter'}</span>
              </div>
              <strong>{summary.byTier[tier].count}</strong>
              <small>{organization.formatMoney(summary.byTier[tier].balance)} past due</small>
              <div className="od-bar">
                <i style={{ width: `${Math.round((summary.byTier[tier].balance / maxTierBalance) * 100)}%` }} />
              </div>
            </button>
          ))}
        </section>
      )}

      {pageError && (
        <p className="od-banner od-error">
          <AlertCircle size={16} />
          {pageError}
        </p>
      )}
      {actionsError && (
        <p className="od-banner od-error" role="alert">
          {actionsError}
        </p>
      )}

      <section className="od-card" aria-label="Accounts" aria-live="polite">
        <div className="od-filters">
          <div className="od-f-row">
            <div className="od-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="Search by name, block or lot"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search homeowners"
                autoComplete="off"
              />
              {search && (
                <button type="button" className="od-clear" onClick={() => setSearch('')} aria-label="Clear search">
                  ×
                </button>
              )}
            </div>
            <select
              className="od-select"
              aria-label="Filter by block"
              value={blockFilter}
              onChange={(e) => setBlockFilter(e.target.value)}
            >
              {blocks.map((b) => (
                <option key={b} value={b}>
                  {b === 'All' ? 'All blocks' : b}
                </option>
              ))}
            </select>
            <select
              className="od-select"
              aria-label="Sort accounts"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
            >
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="od-f-row od-f-tabs">
            <div className="od-tabs" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((s) => (
                <button key={s} type="button" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}>
                  {s}
                  <span className="n">{statusCounts[s] || 0}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="od-f-meta">
            <span>
              {filtered.length} matching lot{filtered.length === 1 ? '' : 's'} of {accounts.length}
            </span>
            <span className="od-chips">
              {agingFilter !== 'All' && (
                <span className="od-chip">
                  {agingFilter}
                  <button type="button" onClick={() => setAgingFilter('All')} aria-label="Remove aging filter">
                    ×
                  </button>
                </span>
              )}
              {blockFilter !== 'All' && (
                <span className="od-chip">
                  {blockFilter}
                  <button type="button" onClick={() => setBlockFilter('All')} aria-label="Remove block filter">
                    ×
                  </button>
                </span>
              )}
              {hasFilters && (
                <button type="button" className="od-linkbtn" onClick={clearFilters}>
                  Clear all filters
                </button>
              )}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="od-empty" aria-busy="true">
            <Skeleton variant="rect" width="100%" height="64px" />
            <Skeleton variant="rect" width="100%" height="64px" />
            <Skeleton variant="rect" width="100%" height="64px" />
            <span className="skeleton-region-status" role="status">
              Loading
            </span>
          </div>
        ) : !dataAvailable ? (
          <div className="od-empty">
            <h3>Unavailable</h3>
            <p>Overdue information is unavailable. Refresh to retry.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="od-empty">
            <h3>No accounts match</h3>
            <p>
              {statusFilter === 'Overdue' && !hasFilters
                ? 'No homeowners are currently overdue.'
                : 'Try another status or clear the filters.'}
            </p>
          </div>
        ) : (
          <div className="od-table-wrap">
            <table className="od-table">
              <thead>
                <tr>
                  <th>Homeowner</th>
                  <th>Block / Lot</th>
                  <th>Days overdue</th>
                  <th className="r">Balance</th>
                  <th>Last payment</th>
                  <th>Last action</th>
                  <th>Status</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountPage.rows.map((account) => {
                  const tierIndex = tierIndexOf(account.agingTier)
                  const isOverdue = account.status === 'Overdue'
                  return (
                    <tr
                      key={account.id}
                      tabIndex={0}
                      aria-label={`Open ${account.name}`}
                      onClick={() => openAccount(account)}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault()
                          openAccount(account)
                        }
                      }}
                    >
                      <td>
                        <div className="od-who">
                          <span className="od-avatar" aria-hidden="true">
                            {initialsOf(account.name)}
                          </span>
                          <div>
                            <b>{account.name}</b>
                            <span className="od-contact" onClick={(event) => event.stopPropagation()}>
                              {account.phone && (
                                <a
                                  href={`tel:${account.phone}`}
                                  title={account.phone}
                                  aria-label={`Call ${account.name}`}
                                >
                                  <Phone size={14} />
                                </a>
                              )}
                              {account.email && (
                                <a
                                  href={`mailto:${account.email}`}
                                  title={account.email}
                                  aria-label={`Email ${account.name}`}
                                >
                                  <Mail size={14} />
                                </a>
                              )}
                              {!account.phone && !account.email && <span className="od-sub">No contact</span>}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {account.block}, {account.lot}
                      </td>
                      <td>
                        {isOverdue ? (
                          <span className="od-days">
                            <b>{Number(account.daysOverdue).toLocaleString()} days</b>
                            <span className={`od-tag t${tierIndex + 1}`}>{account.agingTier}</span>
                          </span>
                        ) : (
                          <span className="od-muted">—</span>
                        )}
                      </td>
                      <td className="r">
                        <span className="od-money">{organization.formatMoney(account.balance)}</span>
                        <span className="od-sub">
                          {account.overdueAmount > 0
                            ? `${organization.formatMoney(account.overdueAmount)} past due`
                            : 'Nothing past due'}
                        </span>
                      </td>
                      <td>
                        {account.lastPaymentAt ? (
                          organization.formatDate(account.lastPaymentAt)
                        ) : (
                          <span className="od-muted">No payments yet</span>
                        )}
                      </td>
                      <td>
                        {actionsLoading ? (
                          <Skeleton variant="rect" width="100px" height="1em" />
                        ) : actionsError ? (
                          <span className="od-muted">History unavailable</span>
                        ) : account.lastAction ? (
                          <>
                            <b className="od-semi">{account.lastAction.action_type}</b>
                            <span className="od-sub">
                              {organization.formatDate(account.lastAction.action_date)}
                              {account.actionCount > 1 ? ` (+${account.actionCount - 1} more)` : ''}
                            </span>
                          </>
                        ) : (
                          <span className="od-muted">No actions logged</span>
                        )}
                      </td>
                      <td>
                        <span className={`od-pill ${account.status.toLowerCase()}`}>{account.status}</span>
                      </td>
                      <td className="r" onClick={(event) => event.stopPropagation()}>
                        <div className="od-row-actions">
                          <button
                            type="button"
                            className="od-row-btn primary"
                            onClick={() => openAccount(account, true)}
                          >
                            + Log action
                          </button>
                          <button type="button" className="od-row-btn" onClick={() => openAccount(account)}>
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!loading && (
          <div className="od-pager">
            <Pager page={accountPage.page} total={filtered.length} onPageChange={accountPage.setPage} />
          </div>
        )}
      </section>

      {detail && (
        <AccountDialog
          key={detail.id}
          account={detail}
          position={detailPosition}
          total={detailIds.length}
          form={logForm}
          setForm={setLogForm}
          saving={logSaving}
          error={logError}
          canLog={Boolean(currentUser?.id)}
          focusForm={focusForm}
          formatMoney={organization.formatMoney}
          formatDate={organization.formatDate}
          onSubmit={submitLogAction}
          onClose={closeAccount}
          onStep={stepAccount}
          onOpenProfile={() => navigate(`/homeowners/${detail.id}`)}
        />
      )}
    </div>
  )
}