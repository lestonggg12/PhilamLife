import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Mail, Phone, Plus, RefreshCw, Search, Users, X } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import { computeLateFee } from '../lib/latepenalty'
import './OverdueAccountsPage.css'

const normalize = (value) => String(value ?? '').trim().toLowerCase()

const STATUS_FILTERS = ['Overdue', 'Pending', 'Partial', 'Paid', 'All']

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

// This page answers a question the rest of the app couldn't: "who hasn't
// paid past the due day, right now" — independent of whether anyone has
// posted a monthly assessment charge for them. It uses the same Due Day /
// Grace Period / Late Penalty settings and computeLateFee() logic as the
// Ledger page's own fallback view, applied to every property directly from
// raw payment history rather than the homeowner_ledger_summary DB view
// (which only reflects posted `homeowner_charges` rows).
export default function OverdueAccountsPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [collectionActions, setCollectionActions] = useState([])
  const [penaltySettings, setPenaltySettings] = useState({
    duesAmount: 0,
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('All')
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
    isRefresh ? setRefreshing(true) : setLoading(true)
    setPageError('')

    const [propertyResult, paymentResult, settingsResult, actionsResult] = await Promise.all([
      supabase.from('properties').select('id, homeowner_name, block, lot_number, contact_phone, contact_email, homeowner_status'),
      supabase
        .from('payments')
        .select('property_id, homeowner_name, block_name, lot_number, amount_paid, previous_balance, remaining_balance, paid_at, status')
        .order('paid_at', { ascending: false }),
      supabase
        .from('system_settings')
        .select('dues_amount, due_day, grace_period_days, late_penalty')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('collection_actions')
        .select('id, property_id, action_type, action_date, details, document_reference, created_by')
        .order('action_date', { ascending: false }),
    ])

    const errors = [propertyResult.error, paymentResult.error, settingsResult.error, actionsResult.error].filter(Boolean)
    if (errors.length > 0) {
      setPageError(`Some records could not be loaded: ${errors.map((e) => e.message).join(' ')}`)
    }

    setProperties(propertyResult.data || [])
    setPayments((paymentResult.data || []).filter((p) => p.status !== 'Voided'))
    setCollectionActions(actionsResult.data || [])
    setPenaltySettings({
      duesAmount: Number(settingsResult.data?.dues_amount) || 0,
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
    setRefreshing(false)
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

  const accounts = useMemo(() => {
    return properties
      .filter((property) => (property.homeowner_status || 'active') === 'active')
      .map((property) => {
      const propertyPayments = payments.filter((payment) => {
        if (payment.property_id != null) return Number(payment.property_id) === Number(property.id)
        return (
          normalize(payment.homeowner_name) === normalize(property.homeowner_name) &&
          normalize(payment.block_name) === normalize(property.block) &&
          normalize(payment.lot_number).replace(/^lot\s*/, '') === String(property.lot_number)
        )
      })
      const latestPayment = propertyPayments[0]
      const dueAmount = latestPayment
        ? Number(latestPayment.previous_balance) || penaltySettings.duesAmount
        : penaltySettings.duesAmount
      const paidAmount = latestPayment ? Number(latestPayment.amount_paid) || 0 : 0
      const balance = latestPayment ? Number(latestPayment.remaining_balance) || 0 : dueAmount

      const lateFee = computeLateFee({
        balance,
        dueDay: penaltySettings.dueDay,
        gracePeriodDays: penaltySettings.gracePeriodDays,
        latePenalty: penaltySettings.latePenalty,
      })

      const status = balance <= 0
        ? 'Paid'
        : lateFee.isOverdue
          ? 'Overdue'
          : paidAmount > 0
            ? 'Partial'
            : 'Pending'

      const propertyActions = (actionsByProperty.get(property.id) || [])
      const lastAction = propertyActions[0] || null

      return {
        id: property.id,
        name: property.homeowner_name,
        block: property.block,
        lot: `Lot ${property.lot_number}`,
        phone: property.contact_phone || '',
        email: property.contact_email || '',
        balance,
        penaltyAmount: lateFee.penaltyAmount,
        totalDue: lateFee.totalDue,
        daysOverdue: lateFee.daysOverdue,
        agingTier: status === 'Overdue' ? agingTierOf(lateFee.daysOverdue) : null,
        lastPaymentAt: latestPayment?.paid_at || null,
        status,
        lastAction,
        actionCount: propertyActions.length,
        actions: propertyActions,
      }
    })
  }, [properties, payments, penaltySettings, actionsByProperty])

  const blocks = useMemo(
    () => ['All', ...new Set(properties.map((p) => p.block).filter(Boolean))].sort(),
    [properties],
  )

  const filtered = useMemo(() => {
    const term = normalize(search)
    return accounts
      .filter((a) => statusFilter === 'All' || a.status === statusFilter)
      .filter((a) => agingFilter === 'All' || a.agingTier === agingFilter)
      .filter((a) => blockFilter === 'All' || a.block === blockFilter)
      .filter((a) => !term || normalize(a.name).includes(term) || normalize(a.lot).includes(term))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance)
  }, [accounts, search, blockFilter, statusFilter, agingFilter])

  const summary = useMemo(() => {
    const overdueAccounts = accounts.filter((a) => a.status === 'Overdue')
    const byTier = Object.fromEntries(
      AGING_TIERS.map((tier) => [
        tier,
        {
          count: overdueAccounts.filter((a) => a.agingTier === tier).length,
          balance: overdueAccounts
            .filter((a) => a.agingTier === tier)
            .reduce((sum, a) => sum + a.balance, 0),
        },
      ]),
    )
    return {
      overdueCount: overdueAccounts.length,
      overdueBalance: overdueAccounts.reduce((sum, a) => sum + a.balance, 0),
      overduePenalties: overdueAccounts.reduce((sum, a) => sum + a.penaltyAmount, 0),
      totalAccounts: accounts.length,
      byTier,
    }
  }, [accounts])

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
    if (!logTarget || !currentUser?.id) {
      setLogError('Unable to identify the current user. Please refresh and try again.')
      return
    }
    if (!logForm.details.trim()) {
      setLogError('Add a short note about what happened.')
      return
    }

    setLogSaving(true)
    setLogError('')

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

    if (error) {
      setLogError(error.message)
      setLogSaving(false)
      return
    }

    setCollectionActions((current) => [data, ...current])
    setLogSaving(false)
    setLogTarget(null)
  }

  return (
    <div className="overdue-page">
      <div className="overdue-header">
        <div>
          <p className="overdue-eyebrow">Collections</p>
          <h1>Overdue Accounts</h1>
          <p>
            Homeowners past Due Day {penaltySettings.dueDay} (+{penaltySettings.gracePeriodDays}-day grace period),
            based on their actual payment history — not on whether a monthly assessment has been posted.
          </p>
        </div>
        <button type="button" className="overdue-refresh-button" onClick={() => loadData(true)} disabled={refreshing}>
          <RefreshCw size={17} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="overdue-summary">
        <div className="overdue-summary-item overdue-summary-flag">
          <span>Overdue accounts</span>
          <strong>{loading ? '—' : summary.overdueCount}</strong>
        </div>
        <div className="overdue-summary-item">
          <span>Overdue balance</span>
          <strong>{loading ? '—' : organization.formatMoney(summary.overdueBalance)}</strong>
        </div>
        <div className="overdue-summary-item">
          <span>Penalties accrued</span>
          <strong>{loading ? '—' : organization.formatMoney(summary.overduePenalties)}</strong>
        </div>
        <div className="overdue-summary-item">
          <span>Total accounts</span>
          <strong>{loading ? '—' : summary.totalAccounts}</strong>
        </div>
      </div>

      {!loading && summary.overdueCount > 0 && (
        <div className="overdue-aging-row" role="group" aria-label="Overdue accounts by aging tier">
          {AGING_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={`overdue-aging-chip tier-${tier === '90+ days' ? '90plus' : tier.replace(/\D/g, '-')} ${agingFilter === tier ? 'active' : ''}`}
              onClick={() => setAgingFilter(agingFilter === tier ? 'All' : tier)}
            >
              <span className="overdue-aging-tier">{tier}</span>
              <span className="overdue-aging-count">{summary.byTier[tier].count}</span>
              <span className="overdue-aging-balance">{organization.formatMoney(summary.byTier[tier].balance)}</span>
            </button>
          ))}
        </div>
      )}

      {pageError && <p className="overdue-message overdue-error"><AlertCircle size={16} />{pageError}</p>}

      <div className="overdue-toolbar">
        <div className="overdue-search-wrap">
          <Search size={16} />
          <input
            type="search"
            placeholder="Search by name or lot..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search homeowners"
          />
        </div>

        <select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)} aria-label="Filter by block">
          {blocks.map((b) => <option key={b} value={b}>{b === 'All' ? 'All Blocks' : b}</option>)}
        </select>

        <select value={agingFilter} onChange={(e) => setAgingFilter(e.target.value)} aria-label="Filter by aging tier">
          <option value="All">All Aging Tiers</option>
          {AGING_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

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
        <span>Showing {filtered.length} of {accounts.length} homeowners</span>
      </div>

      <div className="overdue-list glass-card" aria-live="polite">
        {loading ? (
          <p className="overdue-empty">Loading accounts...</p>
        ) : filtered.length === 0 ? (
          <p className="overdue-empty">
            {statusFilter === 'Overdue' ? 'No homeowners are currently overdue.' : 'No homeowners match your filters.'}
          </p>
        ) : (
          <table className="overdue-table">
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '56px' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Homeowner</th>
                <th>Contact</th>
                <th>Block / Lot</th>
                <th>Days overdue</th>
                <th>Balance</th>
                <th>Total due</th>
                <th>Last pmt</th>
                <th>Last action</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => (
                <tr key={account.id} className={account.status === 'Overdue' ? 'overdue-row-flagged' : ''}>
                  <td className="overdue-name-cell">
                    <button type="button" className="overdue-name-link" onClick={() => navigate(`/homeowners/${account.id}`)}>
                      <span className="overdue-avatar"><Users size={15} /></span>
                      {account.name}
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
                      {!account.phone && !account.email && <span className="overdue-no-action">No contact on file</span>}
                    </div>
                  </td>
                  <td>{account.block}, {account.lot}</td>
                  <td>{account.status === 'Overdue' ? `${account.daysOverdue}d` : '—'}</td>
                  <td>{organization.formatMoney(account.balance)}</td>
                  <td title={account.penaltyAmount > 0 ? `Includes ${organization.formatMoney(account.penaltyAmount)} penalty` : undefined}>
                    {organization.formatMoney(account.totalDue)}
                    {account.penaltyAmount > 0 && <span className="overdue-penalty-flag">+penalty</span>}
                  </td>
                  <td>{account.lastPaymentAt ? organization.formatDate(account.lastPaymentAt) : 'No payments yet'}</td>
                  <td>
                    {account.lastAction ? (
                      <button type="button" className="overdue-action-link" onClick={() => setHistoryTarget(account)}>
                        {account.lastAction.action_type}
                        <small>{organization.formatDate(account.lastAction.action_date)}{account.actionCount > 1 ? ` (+${account.actionCount - 1} more)` : ''}</small>
                      </button>
                    ) : (
                      <span className="overdue-no-action">No actions logged</span>
                    )}
                  </td>
                  <td><span className={`overdue-status-pill status-${account.status.toLowerCase()}`}>{account.status}</span></td>
                  <td>
                    <button type="button" className="overdue-log-button" onClick={() => openLogForm(account)} title="Log a collection action" aria-label="Log a collection action">
                      <Plus size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

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
                <select
                  value={logForm.action_type}
                  onChange={(e) => setLogForm((f) => ({ ...f, action_type: e.target.value }))}
                  disabled={logSaving}
                >
                  {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
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