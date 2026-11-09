import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../components/Select'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Calendar, Mail, Phone, Plus, RefreshCw, Search, Users, X } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { describeOverdueAccount, movedAccountsWithBalance, summarizeOverdueAccounts, verifyOverdueSnapshot } from '../lib/overdueAccounts'
import { fetchAll } from '../lib/fetchAll'
import { useOrganization } from '../context/OrganizationContext'
import './OverdueAccountsPage.css'
import { Pager } from '../components/PagerControls'
import { useListPage, matchesHomeownerSearch } from '../lib/homeownerDirectory'
import Skeleton from '../components/skeleton/Skeleton'

const STATUS_FILTERS = ['Overdue', 'Pending', 'Partial', 'Paid', 'Review', 'All']

const AGING_TIERS = ['1-30 days', '31-60 days', '61-90 days', '90+ days']

const ACTION_TYPES = [
  'Phone Call',
  'Email Sent',
  'Formal Notice',
  'Payment Plan Arranged',
  'Site Visit',
  'Other',
]

function agingTierOf(daysOverdue) {
  if (daysOverdue <= 30) return '1-30 days'
  if (daysOverdue <= 60) return '31-60 days'
  if (daysOverdue <= 90) return '61-90 days'
  return '90+ days'
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
  const [logTarget, setLogTarget] = useState(null)
  const [logForm, setLogForm] = useState({ action_type: ACTION_TYPES[0], details: '', document_reference: '' })
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState('')
  const [historyTarget, setHistoryTarget] = useState(null)

  useEffect(() => {
    loadData()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
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
        fetchAll(() => supabase.from('properties').select('id, homeowner_name, block, lot_number, contact_phone, contact_email, homeowner_status, current_balance')),
        // One small row per homeowner (latest payment) computed by the database.
        fetchAll(() => supabase.from('property_payment_summary').select('property_id, latest_paid_at, latest_amount_paid').order('property_id'), { tiebreaker: null }),
        supabase
          .from('system_settings')
          .select('due_day, grace_period_days, late_penalty')
          .eq('id', 1)
          .maybeSingle(),
        fetchAll(() => supabase
          .from('property_overdue_summary')
          .select('property_id, balance, overdue_amount, is_overdue, days_overdue, aging_complete, aging_date_fallback_count')
          .order('property_id'), { tiebreaker: null }),
      ])
      if (sequence !== loadSequence.current) return
      const errors = [propertyResult.error, paymentResult.error, settingsResult.error, overdueResult.error].filter(Boolean)
      if (errors.length) throw new Error(errors.map((error) => error.message).join(' '))
      verifyOverdueSnapshot(propertyResult.data, paymentResult.data, settingsResult.data, overdueResult.data)

      const unaged = overdueResult.data.filter((row) => row.aging_complete === false)
      if (unaged.length) setPageError(`${unaged.length} account(s) have unreconciled aging data. Their overdue classification requires review.`)
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

      const propertyActions = (actionsByProperty.get(property.id) || [])
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

  const movedWithBalance = dataAvailable ? movedAccountsWithBalance(properties) : []

  const blocks = useMemo(
    () => ['All', ...new Set(properties.map((p) => p.block).filter(Boolean))].sort(),
    [properties],
  )

  const filtered = useMemo(() => {
    return accounts
      .filter((a) => statusFilter === 'All' || a.status === statusFilter)
      .filter((a) => agingFilter === 'All' || a.agingTier === agingFilter)
      .filter((a) => blockFilter === 'All' || a.block === blockFilter)
      .filter((a) => matchesHomeownerSearch({ homeowner_name: a.name, block: a.block, lot_number: a.lot }, search))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance || a.id - b.id)
  }, [accounts, search, blockFilter, statusFilter, agingFilter])

  const accountPage = useListPage(filtered, [search, blockFilter, statusFilter, agingFilter])

  const visibleIds = JSON.stringify([
    ...accountPage.rows.map(account => account.id),
    ...movedWithBalance.map(property => property.id),
  ])
  useEffect(() => {
    if (loading) return undefined
    let cancelled = false
    const ids = JSON.parse(visibleIds)
    setCollectionActions([])
    setActionsError('')
    if (!ids.length) { setActionsLoading(false); return undefined }
    setActionsLoading(true)
    async function loadVisibleActions() {
      try {
        const { data, error } = await fetchAll(() => supabase
          .from('collection_actions')
          .select('id, property_id, action_type, action_date, details, document_reference, created_by')
          .in('property_id', ids)
          .order('action_date', { ascending: false }))
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
    return () => { cancelled = true }
  }, [visibleIds, loading, actionsReload])

  const summary = useMemo(() => {
    return summarizeOverdueAccounts(accounts)
  }, [accounts])

  const filteredSummary = useMemo(() => summarizeOverdueAccounts(filtered), [filtered])

  function openLogForm(account) {
    setLogTarget(account)
    setLogForm({ action_type: ACTION_TYPES[0], details: '', document_reference: '' })
    setLogError('')
  }

  function closeLogForm() {
    if (logSaving) return
    setLogTarget(null)
  }

  async function submitLogAction(event) {
    event.preventDefault()
    if (logSubmitting.current) return
    if (!logTarget || !currentUser?.id) {
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
          property_id: logTarget.id,
          action_type: logForm.action_type,
          details: logForm.details.trim(),
          document_reference: logForm.document_reference.trim() || null,
          created_by: currentUser.id,
        })
        .select('id, property_id, action_type, action_date, details, document_reference, created_by')
        .single()
      if (error) throw error
      if (!data?.id || Number(data.property_id) !== Number(logTarget.id)) {
        throw new Error('The follow-up save could not be confirmed. Refresh before retrying.')
      }
      setCollectionActions((current) => [data, ...current])
      setActionsReload((value) => value + 1)
      notifySuccess(`${logForm.action_type} follow-up saved for ${logTarget.name || logTarget.homeowner_name || 'this homeowner'}.`)
      setLogTarget(null)
    } catch (error) {
      setLogError(`${error.message || 'The follow-up could not be saved.'} If the connection was interrupted, refresh the history before retrying.`)
    } finally {
      logSubmitting.current = false
      setLogSaving(false)
    }
  }

  return (
    <div className="overdue-page">
      <div className="overdue-header">
        <div>
          <p className="overdue-eyebrow">Collections</p>
          <h1>Overdue Accounts</h1>
          <p>
            Homeowners past Due Day {penaltySettings.dueDay} (+{penaltySettings.gracePeriodDays}-day grace period),
            based on outstanding balance items. Only posted penalties are included in balances.
          </p>
        </div>
        <button type="button" className="overdue-refresh-button" onClick={() => loadData(true)} disabled={refreshing}>
          <RefreshCw size={17} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="overdue-summary" aria-label="Overdue account summaries" aria-busy={loading || refreshing}>
        <div className="overdue-summary-item overdue-summary-flag">
          <span><Users size={18} /> Matching accounts</span>
          <strong>{loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : !dataAvailable ? 'Unavailable' : filtered.length}</strong>
        </div>
        <div className="overdue-summary-item">
          <span><AlertCircle size={18} /> Overdue balance</span>
          <strong>{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : !dataAvailable ? 'Unavailable' : organization.formatMoney(filteredSummary.overdueBalance)}</strong>
        </div>
        <div className="overdue-summary-item">
          <span><Calendar size={18} /> Current portion</span>
          <strong>{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : !dataAvailable ? 'Unavailable' : organization.formatMoney(filteredSummary.currentPortion)}</strong>
        </div>
        <div className="overdue-summary-item">
          <span><Phone size={18} /> Follow-ups logged</span>
          <strong>{loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : !dataAvailable ? 'Unavailable' : filtered.reduce((total, account) => total + account.actionCount, 0)}</strong>
        </div>
      </div>

      {!loading && summary.overdueCount > 0 && (
        <div className="overdue-aging-row" role="group" aria-label="Overdue accounts grouped by oldest overdue item">
          {AGING_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={`overdue-aging-chip tier-${tier === '90+ days' ? '90plus' : tier.replace(/\D/g, '-')} ${agingFilter === tier ? 'active' : ''}`}
              onClick={() => setAgingFilter(agingFilter === tier ? 'All' : tier)}
            >
              <span className="overdue-aging-tier">Oldest overdue item: {tier}</span>
              <span className="overdue-aging-count">{summary.byTier[tier].count}</span>
              <span className="overdue-aging-balance">Total past due on these lots: {organization.formatMoney(summary.byTier[tier].balance)}</span>
            </button>
          ))}
        </div>
      )}

      {pageError && <p className="overdue-message overdue-error"><AlertCircle size={16} />{pageError}</p>}

      {!loading && !pageError && movedWithBalance.length > 0 && (
        <section className="overdue-list overdue-moved-review glass-card" aria-label="Moved accounts with outstanding balances">
          <h2>Moved accounts with outstanding balances</h2>
          <p>Review these balances separately from the active collection queue.</p>
          <ul>
            {movedWithBalance.map((property) => {
              const aging = overdueByProperty.get(Number(property.id))
              const account = {
                id: property.id,
                name: property.homeowner_name,
                block: property.block,
                lot: `Lot ${property.lot_number}`,
                actions: actionsByProperty.get(property.id) || [],
              }
              return (
                <li key={property.id}>
                  <strong>{account.name} · {account.block}, {account.lot}</strong>
                  {' '}— {organization.formatMoney(property.current_balance)} outstanding
                  {aging?.aging_complete === true && ` · ${organization.formatMoney(aging.overdue_amount)} past due`}
                  <button type="button" className="overdue-action-link" onClick={() => openLogForm(account)}>Log follow-up</button>
                  {account.actions.length > 0 && (
                    <button type="button" className="overdue-action-link" onClick={() => setHistoryTarget(account)}>Follow-up history</button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="overdue-toolbar">
        <div className="overdue-search-wrap">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search by name, block, or lot..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search homeowners"
          />
        </div>

        <div className="overdue-filter-pair">
          <Select ariaLabel="Filter by block" value={blockFilter} onChange={setBlockFilter} options={blocks.map((b) => ({ value: b, label: b === 'All' ? 'All Blocks' : b }))} />
          <Select ariaLabel="Filter by aging tier" value={agingFilter} onChange={setAgingFilter} options={[{ value: 'All', label: 'All Oldest-Item Age Groups' }, ...AGING_TIERS.map((t) => ({ value: t, label: t }))]} />
        </div>

        <div className="overdue-status-tabs" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={statusFilter === s}
              className={statusFilter === s ? 'active' : ''}
              onClick={() => setStatusFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="overdue-result-row">
        <span>{filtered.length} matching lots of {accounts.length}</span>
      </div>

      {actionsError && <p className="overdue-error" role="alert">{actionsError}</p>}
      <div className="overdue-list glass-card" aria-live="polite">
        {loading ? (
          <div className="overdue-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="64px" /><Skeleton variant="rect" width="100%" height="64px" /><Skeleton variant="rect" width="100%" height="64px" /><Skeleton variant="rect" width="100%" height="64px" /><span className="skeleton-region-status" role="status">Loading</span></div>
        ) : !dataAvailable ? (
          <p className="overdue-empty">Overdue information is unavailable. Refresh to retry.</p>
        ) : filtered.length === 0 ? (
          <p className="overdue-empty">
            {pageError && accounts.length === 0 ? 'Overdue information is unavailable. Refresh to retry.' : statusFilter === 'Overdue' ? 'No homeowners are currently overdue.' : 'No homeowners match your filters.'}
          </p>
        ) : (
          <table className="overdue-table">
            <colgroup>
              <col style={{ width: '19.5%' }} />
              <col style={{ width: '7%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '11.5%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Homeowner</th>
                <th>Contact</th>
                <th>Block / Lot</th>
                <th>Days overdue</th>
                <th>Balance</th>
                <th>Past due</th>
                <th>Last pmt</th>
                <th>Last action</th>
                <th>Status</th>
                <th className="overdue-actions-heading">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accountPage.rows.map((account) => (
                <tr key={account.id} className={account.status === 'Overdue' ? 'overdue-row-flagged' : ''}>
                  <td className="overdue-name-cell">
                    <button type="button" className="overdue-name-link" onClick={() => navigate(`/homeowners/${account.id}`)}>
                      <span className="overdue-avatar"><Users size={15} /></span>
                      <span className="overdue-account-name">{account.name}</span>
                    </button>
                  </td>
                  <td>
                    <div className="overdue-contact-icons">
                      {account.phone && (
                        <a href={`tel:${account.phone}`} className="overdue-contact-link" title={account.phone} aria-label={`Call ${account.name}`}>
                          <Phone size={14} />
                        </a>
                      )}
                      {account.email && (
                        <a href={`mailto:${account.email}`} className="overdue-contact-link" title={account.email} aria-label={`Email ${account.name}`}>
                          <Mail size={14} />
                        </a>
                      )}
                      {!account.phone && !account.email && <span className="overdue-no-action">No contact</span>}
                    </div>
                  </td>
                  <td>{account.block}, {account.lot}</td>
                  <td>{account.status === 'Overdue' ? `${account.daysOverdue}d` : '—'}</td>
                  <td>{organization.formatMoney(account.balance)}</td>
                  <td>
                    {organization.formatMoney(account.overdueAmount)}
                  </td>
                  <td>{account.lastPaymentAt ? organization.formatDate(account.lastPaymentAt).replace(/(\d{4})(?=$|,)/, (year) => year.slice(-2)) : 'No payments yet'}</td>
                  <td>
                    {actionsLoading ? <span className="overdue-no-action"><Skeleton variant="rect" width="100px" height="1em" /></span> : actionsError ? <span className="overdue-no-action">History unavailable</span> : account.lastAction ? (
                      <button type="button" className="overdue-action-link" onClick={() => setHistoryTarget(account)}>
                        {account.lastAction.action_type}
                        <small>{organization.formatDate(account.lastAction.action_date).replace(/(\d{4})(?=$|,)/, (year) => year.slice(-2))}{account.actionCount > 1 ? ` (+${account.actionCount - 1} more)` : ''}</small>
                      </button>
                    ) : (
                      <span className="overdue-no-action">No actions logged</span>
                    )}
                  </td>
                  <td className="overdue-status-cell">
                    <span className={`overdue-status-pill status-${account.status.toLowerCase()}`}>{account.status}</span>
                  </td>
                  <td>
                    <div className="overdue-row-actions">
                      <button type="button" className="overdue-view-button" onClick={() => navigate(`/homeowners/${account.id}`)} aria-label={`View ${account.name}`}>
                        View
                      </button>
                      <button type="button" className="overdue-log-button" onClick={() => openLogForm(account)} title="Log a collection action" aria-label="Log a collection action">
                        <Plus size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && <Pager page={accountPage.page} total={filtered.length} onPageChange={accountPage.setPage} />}

      {logTarget && (
        <div className="overdue-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeLogForm() }}>
          <section className="overdue-modal" role="dialog" aria-modal="true" aria-labelledby="log-action-title">
            <div className="overdue-modal-header">
              <div>
                <h2 id="log-action-title">Log Collection Action</h2>
                <p>{logTarget.name} — {logTarget.block}, {logTarget.lot}</p>
              </div>
              <button type="button" className="overdue-close-button" onClick={closeLogForm} disabled={logSaving} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <form className="overdue-log-form" onSubmit={submitLogAction}>
              <label>
                Action type
                <Select ariaLabel="Action type" value={logForm.action_type} onChange={(value) => setLogForm((f) => ({ ...f, action_type: value }))} disabled={logSaving} options={ACTION_TYPES.map((t) => ({ value: t, label: t }))} />
              </label>

              <label>
                Details
                <textarea
                  rows={3}
                  value={logForm.details}
                  onChange={(e) => setLogForm((f) => ({ ...f, details: e.target.value }))}
                  placeholder="What happened, what was agreed, next steps..."
                  disabled={logSaving}
                  required
                />
              </label>

              <label>
                Document reference (optional)
                <input
                  type="text"
                  value={logForm.document_reference}
                  onChange={(e) => setLogForm((f) => ({ ...f, document_reference: e.target.value }))}
                  placeholder="Notice #, letter reference, etc."
                  disabled={logSaving}
                />
              </label>

              {logError && <p className="overdue-form-error">{logError}</p>}

              <div className="overdue-form-actions">
                <button type="button" className="overdue-cancel-button" onClick={closeLogForm} disabled={logSaving}>Cancel</button>
                <button type="submit" className="overdue-submit-button" disabled={logSaving}>
                  {logSaving ? 'Saving...' : 'Save Action'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {historyTarget && (
        <div className="overdue-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setHistoryTarget(null) }}>
          <section className="overdue-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
            <div className="overdue-modal-header">
              <div>
                <h2 id="history-title">Action History</h2>
                <p>{historyTarget.name} — {historyTarget.block}, {historyTarget.lot}</p>
              </div>
              <button type="button" className="overdue-close-button" onClick={() => setHistoryTarget(null)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="overdue-history-list">
              {historyTarget.actions.length === 0 ? (
                <p className="overdue-empty">No actions logged yet.</p>
              ) : (
                historyTarget.actions.map((action) => (
                  <div key={action.id} className="overdue-history-item">
                    <div className="overdue-history-item-head">
                      <strong>{action.action_type}</strong>
                      <span>{organization.formatDate(action.action_date, { withTime: true })}</span>
                    </div>
                    <p>{action.details}</p>
                    {action.document_reference && <small>Ref: {action.document_reference}</small>}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}