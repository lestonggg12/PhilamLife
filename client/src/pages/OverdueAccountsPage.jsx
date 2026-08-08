import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, RefreshCw, Search, Users } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import { computeLateFee } from '../lib/latepenalty'
import './OverdueAccountsPage.css'

const normalize = (value) => String(value ?? '').trim().toLowerCase()

const STATUS_FILTERS = ['Overdue', 'Pending', 'Partial', 'Paid', 'All']

// This page answers a question the rest of the app couldn't: "who hasn't
// paid past the due day, right now" — independent of whether anyone has
// posted a monthly assessment charge for them. It uses the same Due Day /
// Grace Period / Late Penalty settings and computeLateFee() logic as the
// Ledger page's own fallback view, applied to every property directly from
// raw payment history rather than the homeowner_ledger_summary DB view
// (which only reflects posted `homeowner_charges` rows).
export default function OverdueAccountsPage() {
  const { organization } = useOrganization()
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
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

  useEffect(() => {
    loadData()
  }, [])

  async function loadData(isRefresh = false) {
    isRefresh ? setRefreshing(true) : setLoading(true)
    setPageError('')

    const [propertyResult, paymentResult, settingsResult] = await Promise.all([
      supabase.from('properties').select('id, homeowner_name, block, lot_number'),
      supabase
        .from('payments')
        .select('property_id, homeowner_name, block_name, lot_number, amount_paid, previous_balance, remaining_balance, paid_at, status')
        .order('paid_at', { ascending: false }),
      supabase
        .from('system_settings')
        .select('dues_amount, due_day, grace_period_days, late_penalty')
        .eq('id', 1)
        .maybeSingle(),
    ])

    const errors = [propertyResult.error, paymentResult.error, settingsResult.error].filter(Boolean)
    if (errors.length > 0) {
      setPageError(`Some records could not be loaded: ${errors.map((e) => e.message).join(' ')}`)
    }

    setProperties(propertyResult.data || [])
    setPayments((paymentResult.data || []).filter((p) => p.status !== 'Voided'))
    setPenaltySettings({
      duesAmount: Number(settingsResult.data?.dues_amount) || 0,
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
    setRefreshing(false)
  }

  const accounts = useMemo(() => {
    return properties.map((property) => {
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

      return {
        id: property.id,
        name: property.homeowner_name,
        block: property.block,
        lot: `Lot ${property.lot_number}`,
        balance,
        penaltyAmount: lateFee.penaltyAmount,
        totalDue: lateFee.totalDue,
        daysOverdue: lateFee.daysOverdue,
        lastPaymentAt: latestPayment?.paid_at || null,
        status,
      }
    })
  }, [properties, payments, penaltySettings])

  const blocks = useMemo(
    () => ['All', ...new Set(properties.map((p) => p.block).filter(Boolean))].sort(),
    [properties],
  )

  const filtered = useMemo(() => {
    const term = normalize(search)
    return accounts
      .filter((a) => statusFilter === 'All' || a.status === statusFilter)
      .filter((a) => blockFilter === 'All' || a.block === blockFilter)
      .filter((a) => !term || normalize(a.name).includes(term) || normalize(a.lot).includes(term))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || b.balance - a.balance)
  }, [accounts, search, blockFilter, statusFilter])

  const summary = useMemo(() => {
    const overdueAccounts = accounts.filter((a) => a.status === 'Overdue')
    return {
      overdueCount: overdueAccounts.length,
      overdueBalance: overdueAccounts.reduce((sum, a) => sum + a.balance, 0),
      overduePenalties: overdueAccounts.reduce((sum, a) => sum + a.penaltyAmount, 0),
      totalAccounts: accounts.length,
    }
  }, [accounts])

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
            <thead>
              <tr>
                <th>Homeowner</th>
                <th>Block / Lot</th>
                <th>Days overdue</th>
                <th>Balance</th>
                <th>Penalty</th>
                <th>Total due</th>
                <th>Last payment</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => (
                <tr key={account.id} className={account.status === 'Overdue' ? 'overdue-row-flagged' : ''}>
                  <td className="overdue-name-cell">
                    <span className="overdue-avatar"><Users size={15} /></span>
                    {account.name}
                  </td>
                  <td>{account.block}, {account.lot}</td>
                  <td>{account.status === 'Overdue' ? `${account.daysOverdue}d` : '—'}</td>
                  <td>{organization.formatMoney(account.balance)}</td>
                  <td>{account.penaltyAmount > 0 ? organization.formatMoney(account.penaltyAmount) : '—'}</td>
                  <td>{organization.formatMoney(account.totalDue)}</td>
                  <td>{account.lastPaymentAt ? organization.formatDate(account.lastPaymentAt) : 'No payments yet'}</td>
                  <td><span className={`overdue-status-pill status-${account.status.toLowerCase()}`}>{account.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}