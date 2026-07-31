import React, { useEffect, useMemo, useState } from 'react'
import './LedgerPage.css'
import { FileText, TrendingUp, AlertCircle } from '../components/Icons'
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

const normalize = (value) => String(value ?? '').trim().toLowerCase()

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
  const [pageError, setPageError] = useState('')

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageHomeowners = role === 'admin' || role === 'secretary'
  const actorName = currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadLedger()
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
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadLedger() {
    setLoading(true)
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
        status,
      }
    })
  }, [properties, payments, duesAmount, penaltySettings])

  const filtered = useMemo(() => {
    const term = normalize(search)
    return ledgerEntries.filter((entry) => {
      const matchesSearch =
        normalize(entry.name).includes(term) || normalize(entry.lot).includes(term)
      const matchesBlock = blockFilter === 'all' || entry.block === blockFilter
      const matchesStatus = statusFilter === 'all' || entry.status === statusFilter
      return matchesSearch && matchesBlock && matchesStatus
    })
  }, [ledgerEntries, search, blockFilter, statusFilter])

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

  return (
    <div className="ledger-page">
      <div className="ledger-header-row">
        <div className="ledger-header">
          <h1>Ledger</h1>
          <p>Track homeowner dues, payments, and outstanding balances.</p>
        </div>

        {canManageHomeowners && (
          <div className="ledger-header-actions">
          </div>
        )}
      </div>

      {pageError && <p className="ledger-load-error">{pageError}</p>}

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

      <div className="ledger-toolbar">
        <input
          type="search"
          placeholder="Search by name or lot..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="ledger-search"
        />
        <select value={blockFilter} onChange={(event) => setBlockFilter(event.target.value)} className="ledger-select" disabled={loading}>
          <option value="all">{loading ? 'Loading blocks...' : 'All Blocks'}</option>
          {blocks.map((block) => <option key={block.id} value={block.name}>{block.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="ledger-select">
          <option value="all">All Statuses</option>
          <option value="Paid">Paid</option>
          <option value="Partial">Partial</option>
          <option value="Pending">Pending</option>
          <option value="Overdue">Overdue</option>
        </select>
      </div>

      <div className="ledger-table-wrap glass-card">
        <table className="ledger-table">
          <thead>
            <tr><th>Homeowner</th><th>Block / Lot</th><th>Due</th><th>Paid</th><th>Balance</th><th>Late Penalty</th><th>Last Payment</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="ledger-empty">Loading ledger...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan="7" className="ledger-empty">No homeowner records found.</td></tr>
            ) : filtered.map((entry) => (
              <tr key={entry.id}>
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