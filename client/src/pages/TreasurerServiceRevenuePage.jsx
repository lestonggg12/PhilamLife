import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, DollarSign, TrendingUp, Clock, Search } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import Loader from '../components/Loader'
import './TreasurerServiceRevenue.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

function statusLabel(status) {
  if (status === 'paid') return 'Paid'
  if (status === 'partial') return 'Partial'
  return status || '—'
}

function manilaDateKey(value) {
  if (!value) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function transactionPaymentStatus(transaction) {
  const amountDue = Number(transaction.amount_due) || 0
  const amountPaid = Number(transaction.amount_paid) || 0

  return transaction.payment_status === 'paid' || amountPaid >= amountDue
    ? 'paid'
    : 'outstanding'
}

export default function TreasurerServiceRevenuePage() {
  const { organization } = useOrganization()
  const [transactions, setTransactions] = useState([])
  const [totals, setTotals] = useState({ total: 0, month: 0, owed: 0, byService: [] })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [serviceFilter, setServiceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [showBreakdown, setShowBreakdown] = useState(() => {
    try {
      return localStorage.getItem('tsr-breakdown-open') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    loadTransactions()
  }, [fromDate, toDate])

  useEffect(() => {
    try {
      localStorage.setItem('tsr-breakdown-open', showBreakdown ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [showBreakdown])

  async function loadTransactions() {
    setLoading(true)
    setPageError('')

    let query = supabase.from('service_transactions').select('*')
      .order('paid_at', { ascending: false }).limit(500)
    if (fromDate) query = query.gte('paid_at', `${fromDate}T00:00:00+08:00`)
    if (toDate) query = query.lte('paid_at', `${toDate}T23:59:59.999+08:00`)
    const [{ data, error }, summaryResult, balanceResult] = await Promise.all([
      query,
      supabase.rpc('service_revenue_summary'),
      supabase.from('service_balances').select('balance_due'),
    ])
    const s = summaryResult.data || {}
    setTotals({
      total: Number(s.total_collected) || 0,
      month: Number(s.collected_this_month) || 0,
      owed: (balanceResult.data || []).reduce((sum, r) => sum + (Number(r.balance_due) || 0), 0),
      byService: (s.by_service || []).map((r) => [r.name, Number(r.amount) || 0]),
    })

    if (error) {
      setPageError(`Service revenue could not be loaded: ${error.message}`)
    }

    setTransactions(data || [])
    setLoading(false)
  }

  const serviceNames = useMemo(() => {
    return totals.byService.map(([name]) => name).sort()
  }, [totals])

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return transactions.filter((transaction) => {
      const paymentDate = manilaDateKey(transaction.paid_at)
      const paymentStatus = transactionPaymentStatus(transaction)
      const searchableValues = [
        transaction.receipt_number,
        transaction.customer_name,
        transaction.block_name,
        transaction.lot_number,
        transaction.payment_method,
        transaction.service_name,
        statusLabel(transaction.payment_status),
      ]

      const matchesSearch = !normalizedSearch || searchableValues.some(
        (value) => String(value || '').toLowerCase().includes(normalizedSearch),
      )
      const matchesService = serviceFilter === 'all'
        || transaction.service_name === serviceFilter
      const matchesStatus = statusFilter === 'all'
        || paymentStatus === statusFilter
      const matchesFromDate = !fromDate || (paymentDate && paymentDate >= fromDate)
      const matchesToDate = !toDate || (paymentDate && paymentDate <= toDate)

      return matchesSearch
        && matchesService
        && matchesStatus
        && matchesFromDate
        && matchesToDate
    })
  }, [
    transactions,
    searchTerm,
    serviceFilter,
    statusFilter,
    fromDate,
    toDate,
  ])

  const summary = useMemo(() => ({
    totalCollected: totals.total,
    collectedThisMonth: totals.month,
    outstanding: totals.owed,
    byService: totals.byService,
    topService: totals.byService[0]
      ? { name: totals.byService[0][0], amount: totals.byService[0][1] }
      : null,
  }), [totals])

  function clearFilters() {
    setSearchTerm('')
    setServiceFilter('all')
    setStatusFilter('all')
    setFromDate('')
    setToDate('')
  }

  const hasActiveFilters = Boolean(
    searchTerm
    || serviceFilter !== 'all'
    || statusFilter !== 'all'
    || fromDate
    || toDate,
  )

  return (
    <div className="tsr-page">
      <div className="tsr-page-header">
        <div>
          <h1 className="tsr-page-title">Amenity & Service Revenue</h1>
          <p className="tsr-page-subtitle">
            Review income collected from bookable amenities and services.
          </p>
        </div>

      </div>

      {pageError && (
        <p className="tsr-error">
          <AlertCircle size={14} /> {pageError}
        </p>
      )}

      <div className="tsr-stats-grid">
        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Collected This Month</span>
            <div className="tsr-stat-icon-box">
              <DollarSign size={18} />
            </div>
          </div>
          <h3 className="tsr-stat-value">{loading ? '—' : peso.format(summary.collectedThisMonth)}</h3>
        </div>

        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Total Collected</span>
            <div className="tsr-stat-icon-box tsr-icon-success">
              <TrendingUp size={18} />
            </div>
          </div>
          <h3 className="tsr-stat-value">{loading ? '—' : peso.format(summary.totalCollected)}</h3>
        </div>

        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Outstanding</span>
            <div className="tsr-stat-icon-box tsr-icon-warning">
              <Clock size={18} />
            </div>
          </div>
          <h3 className="tsr-stat-value">{loading ? '—' : peso.format(summary.outstanding)}</h3>
        </div>

        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Top Service</span>
            <div className="tsr-stat-icon-box tsr-icon-accent">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </div>
          </div>
          <h3 className="tsr-stat-value tsr-stat-value-sm">
            {loading || !summary.topService ? '—' : summary.topService.name}
          </h3>
          {!loading && summary.topService && (
            <p className="tsr-stat-sub">
              {peso.format(summary.topService.amount)}
              {summary.totalCollected > 0 && (
                <> · {((summary.topService.amount / summary.totalCollected) * 100).toFixed(0)}% of total</>
              )}
            </p>
          )}
        </div>
      </div>

      <section className="tsr-breakdown-section">
        <button
          type="button"
          className="tsr-breakdown-toggle"
          onClick={() => setShowBreakdown((open) => !open)}
          aria-expanded={showBreakdown}
          aria-controls="tsr-breakdown-panel"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span>Revenue by Service</span>
          <svg
            className={`tsr-breakdown-chevron${showBreakdown ? ' is-open' : ''}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div
          id="tsr-breakdown-panel"
          className={`tsr-breakdown-collapse${showBreakdown ? ' is-open' : ''}`}
          aria-hidden={!showBreakdown}
        >
          <div className="tsr-breakdown-collapse-inner">
            <div className="tsr-breakdown-panel">
              {loading ? (
                <Loader variant="panel" />
              ) : summary.byService.length === 0 ? (
                <div className="tsr-state">No data yet.</div>
              ) : (
                <div className="tsr-breakdown-grid">
                  {summary.byService.map(([name, amount]) => {
                    const pct = summary.totalCollected > 0
                      ? (amount / summary.totalCollected) * 100
                      : 0
                    return (
                      <div className="tsr-breakdown-row" key={name}>
                        <div className="tsr-breakdown-top">
                          <span className="tsr-breakdown-name">{name}</span>
                          <span className="tsr-breakdown-amount">
                            {peso.format(amount)}{' '}
                            <span className="tsr-breakdown-pct">· {pct.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="tsr-breakdown-bar-track">
                          <div className="tsr-breakdown-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="tsr-content-grid">
        <div className="tsr-table-panel">
          <h3 className="tsr-section-title">Transaction History</h3>

          <div className="tsr-controls">
            <label className="tsr-control tsr-search-control">
              <span>Search</span>
              <div className="tsr-search-field">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Receipt, customer, block/lot, method..."
                />
              </div>
            </label>

            <label className="tsr-control">
              <span>Service</span>
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
              >
                <option value="all">All Services</option>
                {serviceNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            <label className="tsr-control">
              <span>Payment Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="paid">Fully Paid</option>
                <option value="outstanding">Partial / Outstanding</option>
              </select>
            </label>

            <label className="tsr-control">
              <span>From Date</span>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>

            <label className="tsr-control">
              <span>To Date</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>

            <button
              type="button"
              className="tsr-clear-button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              Clear Filters
            </button>
          </div>

          <p className="tsr-result-count">
            Showing {filteredTransactions.length} of {transactions.length}
            {transactions.length >= 500 ? '+ (latest 500; narrow the dates for older)' : ''} transactions
          </p>

          {loading ? (
            <Loader variant="panel" />
          ) : filteredTransactions.length === 0 ? (
            <div className="tsr-state">No service transactions found.</div>
          ) : (
            <div className="tsr-table-wrap">
              <table className="tsr-table">
                <thead>
                  <tr>
                    <th>Receipt No.</th>
                    <th>Payment Date</th>
                    <th>Service</th>
                    <th>Customer</th>
                    <th>Block / Lot</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th className="tsr-amount-col">Due</th>
                    <th className="tsr-amount-col">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.receipt_number}</strong></td>
                      <td>{t.paid_at ? organization.formatDate(t.paid_at, { withTime: true }) : '—'}</td>
                      <td>{t.service_name}</td>
                      <td>{t.customer_name}</td>
                      <td>{t.block_name}, Lot {t.lot_number}</td>
                      <td>{t.payment_method}</td>
                      <td>
                        <span className={`tsr-status-pill tsr-status-${t.payment_status}`}>
                          {statusLabel(t.payment_status)}
                        </span>
                      </td>
                      <td className="tsr-amount-col">{peso.format(Number(t.amount_due) || 0)}</td>
                      <td className="tsr-amount-col tsr-amount-paid">{peso.format(Number(t.amount_paid) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}