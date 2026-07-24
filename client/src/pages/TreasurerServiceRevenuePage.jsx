import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, DollarSign, TrendingUp, Clock } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import './TreasurerServiceRevenue.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
})

function statusLabel(status) {
  if (status === 'paid') return 'Paid'
  if (status === 'partial') return 'Partial'
  return status || '—'
}

function manilaMonthKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}`
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
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [serviceFilter, setServiceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    loadTransactions()
  }, [])

  async function loadTransactions() {
    setLoading(true)
    setPageError('')

    const { data, error } = await supabase
      .from('service_transactions')
      .select('*')
      .order('paid_at', { ascending: false })

    if (error) {
      setPageError(`Service revenue could not be loaded: ${error.message}`)
    }

    setTransactions(data || [])
    setLoading(false)
  }

  const serviceNames = useMemo(() => {
    const names = new Set(transactions.map((t) => t.service_name).filter(Boolean))
    return [...names].sort()
  }, [transactions])

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

  const summary = useMemo(() => {
    const currentMonthKey = manilaMonthKey()

    const totalCollected = transactions.reduce(
      (sum, t) => sum + (Number(t.amount_paid) || 0),
      0,
    )
    const outstanding = transactions.reduce(
      (sum, t) => sum + Math.max(
        (Number(t.amount_due) || 0) - (Number(t.amount_paid) || 0),
        0,
      ),
      0,
    )

    const collectedThisMonth = transactions
      .filter((t) => t.paid_at && manilaMonthKey(t.paid_at) === currentMonthKey)
      .reduce((sum, t) => sum + (Number(t.amount_paid) || 0), 0)

    const byService = new Map()
    transactions.forEach((t) => {
      const key = t.service_name || 'Uncategorized'
      byService.set(key, (byService.get(key) || 0) + (Number(t.amount_paid) || 0))
    })

    const topService = [...byService.entries()].sort((a, b) => b[1] - a[1])[0]

    return {
      totalCollected,
      collectedThisMonth,
      outstanding,
      byService: [...byService.entries()].sort((a, b) => b[1] - a[1]),
      topService: topService ? { name: topService[0], amount: topService[1] } : null,
    }
  }, [transactions])

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
          <span className="tsr-stat-label">Top Service</span>
          <h3 className="tsr-stat-value tsr-stat-value-sm">
            {loading || !summary.topService ? '—' : summary.topService.name}
          </h3>
        </div>
      </div>

      <div className="tsr-content-grid">
        <div className="tsr-table-panel">
          <h3 className="tsr-section-title">Transaction History</h3>

          <div className="tsr-controls">
            <label className="tsr-control tsr-search-control">
              <span>Search</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Receipt, customer, block/lot, method..."
              />
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
            Showing {filteredTransactions.length} of {transactions.length} transactions
          </p>

          {loading ? (
            <div className="tsr-state">Loading transactions...</div>
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
                      <td>{t.paid_at ? dateTimeFormatter.format(new Date(t.paid_at)) : '—'}</td>
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

        <div className="tsr-breakdown-panel">
          <h3 className="tsr-section-title">Revenue by Service</h3>

          {loading ? (
            <div className="tsr-state">Loading...</div>
          ) : summary.byService.length === 0 ? (
            <div className="tsr-state">No data yet.</div>
          ) : (
            summary.byService.map(([name, amount]) => {
              const pct = summary.totalCollected > 0 ? (amount / summary.totalCollected) * 100 : 0
              return (
                <div className="tsr-breakdown-row" key={name}>
                  <div className="tsr-breakdown-top">
                    <span className="tsr-breakdown-name">{name}</span>
                    <span className="tsr-breakdown-amount">{peso.format(amount)}</span>
                  </div>
                  <div className="tsr-breakdown-bar-track">
                    <div className="tsr-breakdown-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}