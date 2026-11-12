import { Eye, Ban } from 'lucide-react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, DollarSign, TrendingUp, Clock, Search, RefreshCw } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import Skeleton from '../components/skeleton/Skeleton'
import DateField from '../components/DateField'
import Select from '../components/Select'
import ActionDialog from '../components/ActionDialog'
import { ReceiptDialog } from '../components/ReceiptSheet'
import { buildReceiptModel } from '../lib/receiptModel'
import { printReceipt } from '../lib/printReceipt'
import { useSettledAmountStatus } from '../lib/useSettledAmount'
import ServiceVoidDialog from '../components/ServiceVoidDialog'
import { loadServiceRevenue, transactionPaymentStatus } from '../lib/treasurerFinance'
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

export default function TreasurerServiceRevenuePage() {
  const { organization } = useOrganization()
  const [transactions, setTransactions] = useState([])
  const [totals, setTotals] = useState({ total: null, month: null, owed: null, byService: [] })
  const [owedIds, setOwedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [recentOnly, setRecentOnly] = useState(true)
  const [serviceFilter, setServiceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedReceipt, setSelectedReceipt] = useState(null)
  const [voidTarget, setVoidTarget] = useState(null)
  const [receiptPrintNotice, setReceiptPrintNotice] = useState('')
  const settlement = useSettledAmountStatus(selectedReceipt)
  const request = useRef(0)
  useEffect(() => {
    loadTransactions()
    return () => { request.current += 1 }
  }, [fromDate, toDate])

  async function loadTransactions() {
    const sequence = ++request.current
    setLoading(true)
    setPageError('')
    try {
      const result = await loadServiceRevenue(supabase, { fromDate, toDate })
      if (sequence !== request.current) return
      setTotals(result.totals); setOwedIds(result.owedIds); setTransactions(result.transactions)
    } catch (error) {
      if (sequence !== request.current) return
      setPageError(`Service revenue is unavailable: ${error.message}`)
      setTotals({ total: null, month: null, owed: null, byService: [] })
      setTransactions([]); setOwedIds(new Set())
    } finally {
      if (sequence === request.current) setLoading(false)
    }
  }

  const serviceNames = useMemo(() => {
    return totals.byService.map(([name]) => name).sort()
  }, [totals])

  const filteredTransactions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return transactions.filter((transaction) => {
      const paymentDate = manilaDateKey(transaction.paid_at)
      const paymentStatus = transactionPaymentStatus(transaction, owedIds)
      const searchableValues = [
        transaction.receipt_number,
        transaction.customer_name,
        transaction.block_name,
        transaction.lot_number,
        transaction.payment_method,
        transaction.service_name,
        statusLabel(paymentStatus),
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
    owedIds,
    searchTerm,
    serviceFilter,
    statusFilter,
    fromDate,
    toDate,
  ])

  const visibleTransactions = useMemo(() => {
    const newest = [...filteredTransactions].sort((a, b) => (Date.parse(b.paid_at) || 0) - (Date.parse(a.paid_at) || 0) || String(b.id).localeCompare(String(a.id)))
    return recentOnly ? newest.slice(0, 5) : newest
  }, [filteredTransactions, recentOnly])

  const summary = useMemo(() => ({
    totalCollected: totals.total,
    collectedThisMonth: totals.month,
    outstanding: totals.owed,
    byService: totals.byService,
    topService: totals.byService[0]
      ? { name: totals.byService[0][0], amount: totals.byService[0][1] }
      : null,
  }), [totals])

  const selectedReceiptModel = selectedReceipt
    ? buildReceiptModel('service', selectedReceipt, organization, {
        settledAmount: settlement.amount,
      })
    : null

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
          <p className="tsr-eyebrow">Treasurer workspace</p>
          <h1 className="tsr-page-title">Amenity & Service Revenue</h1>
          <p className="tsr-page-subtitle">
            Review income collected from bookable amenities and services.
          </p>
        </div>

        <button
          type="button"
          className="tsr-refresh-button"
          onClick={() => loadTransactions()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'tsr-spin-icon' : ''} />
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
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
          <h3 className="tsr-stat-value">{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(summary.collectedThisMonth)}</h3><p className="tsr-stat-caption">Active receipts · current month</p>
        </div>

        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Total Collected (All Time)</span>
            <div className="tsr-stat-icon-box tsr-icon-success">
              <TrendingUp size={18} />
            </div>
          </div>
          <h3 className="tsr-stat-value">{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(summary.totalCollected)}</h3><p className="tsr-stat-caption">Active receipts across all dates</p>
        </div>

        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Outstanding (All Time)</span>
            <div className="tsr-stat-icon-box tsr-icon-warning">
              <Clock size={18} />
            </div>
          </div>
          <h3 className="tsr-stat-value">{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(summary.outstanding)}</h3><p className="tsr-stat-caption">Remaining balances across all dates</p>
        </div>

        <div className="tsr-stat-card">
          <div className="tsr-stat-top">
            <span className="tsr-stat-label">Top service revenue</span>
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
          <h3 className="tsr-stat-value">
            {loading || !summary.topService ? '—' : peso.format(summary.topService.amount)}
          </h3>
          {!loading && summary.topService && (
            <p className="tsr-stat-sub">
              {summary.topService.name}
              {summary.totalCollected > 0 && (
                <> · {((summary.topService.amount / summary.totalCollected) * 100).toFixed(0)}% of total</>
              )}
            </p>
          )}
        </div>
      </div>

      <details className="tsr-totals-note"><summary>About these revenue totals</summary>      <p className="tsr-result-count">
        Revenue cards show all-time totals except Collected This Month. Date filters below apply to transaction history only. Paid (Receipt) shows the payment recorded on that receipt; later balance collections appear as separate receipts.
      </p>      </details>

      <section className="tsr-breakdown-section">
        <div className="tsr-revenue-heading"><div><h3>Revenue by service</h3><p>See which amenities contribute to collections.</p></div><span>All time · Active receipts</span></div>

        <div
          id="tsr-breakdown-panel"
          className="tsr-revenue-content"
        >
          <div className="tsr-breakdown-collapse-inner">
            <div className="tsr-breakdown-panel">
              {loading ? (
                <div aria-busy="true"><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><span className="skeleton-region-status" role="status">Loading</span></div>
              ) : pageError ? (
                <p className="tsr-empty">Service breakdown is unavailable. Refresh to retry.</p>
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
          <div className="tsr-history-heading"><div><h3 className="tsr-section-title">{recentOnly ? 'Recent transactions' : 'Transaction history'}</h3><p>Latest recorded receipts first. Search or filter to narrow the list.</p></div><div className="tsr-history-tabs" role="group" aria-label="Transaction history range"><button type="button" className={recentOnly ? 'active' : ''} aria-pressed={recentOnly} onClick={() => setRecentOnly(true)}>Recent 5</button><button type="button" className={!recentOnly ? 'active' : ''} aria-pressed={!recentOnly} onClick={() => { clearFilters(); setRecentOnly(false); }}>All records</button></div></div>

          <section className="tsr-filter-panel" aria-label="Filter transactions"><div className="tsr-controls">
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

            <div className="tsr-control">
              <span>Service</span>
              <Select
                ariaLabel="Filter by service"
                value={serviceFilter}
                onChange={setServiceFilter}
                options={[
                  { value: 'all', label: 'All Services' },
                  ...serviceNames.map((name) => ({ value: name, label: name })),
                ]}
              />
            </div>

            <div className="tsr-control">
              <span>Payment Status</span>
              <Select
                ariaLabel="Filter by payment status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'paid', label: 'Fully Paid' },
                  { value: 'outstanding', label: 'Partial / Outstanding' },
                  { value: 'voided', label: 'Voided' },
                ]}
              />
            </div>

            <div className="tsr-control">
              <span>From Date</span>
              <DateField ariaLabel="From date" value={fromDate} max={toDate || undefined} onChange={setFromDate} />
            </div>

            <div className="tsr-control">
              <span>To Date</span>
              <DateField ariaLabel="To date" value={toDate} min={fromDate || undefined} onChange={setToDate} />
            </div>

            <button
              type="button"
              className="tsr-clear-button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              Clear Filters
            </button>
          </div></section>

          <p className="tsr-result-count">
            {pageError ? 'Transaction count unavailable' : <>
              Showing {visibleTransactions.length} of {filteredTransactions.length} matching transactions · Newest first
            </>}
          </p>

          {loading ? (
            <div className="tsr-state" role="status" aria-live="polite">Loading service transactions...</div>
          ) : pageError ? (
            <p className="tsr-empty">Service data is unavailable. Refresh to retry.</p>
          ) : filteredTransactions.length === 0 ? (
            <div className="tsr-state">No service transactions found.</div>
          ) : (
            <div className="tsr-table-wrap">
              <table className="tsr-table">
                <thead>
                  <tr>
                    <th>Receipt / Payment Date</th>
                    <th>Amenity / Service</th>
                    <th>Customer / Property</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th className="tsr-amount-col">Due</th>
                    <th className="tsr-amount-col">Paid (Receipt)</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTransactions.map((t) => (
                    <tr key={t.id}>

                      <td><strong>{t.receipt_number}</strong><small className="tsr-row-sub">{t.paid_at ? organization.formatDate(t.paid_at, { withTime: true }) : '—'}</small></td>
                      <td>{t.service_name}</td>
                      <td><strong>{t.customer_name}</strong><small className="tsr-row-sub">{t.block_name} · Lot {t.lot_number}</small></td>
                      <td>{t.payment_method}</td>
                      <td>
                        <span className={`tsr-status-pill tsr-status-${transactionPaymentStatus(t, owedIds)}`}>
                          {statusLabel(transactionPaymentStatus(t, owedIds))}
                        </span>
                      </td>
                      <td className="tsr-amount-col">{peso.format(Number(t.amount_due) || 0)}</td>
                      <td className="tsr-amount-col tsr-amount-paid">{transactionPaymentStatus(t, owedIds) === 'voided' ? 'Voided' : peso.format(Number(t.amount_paid) || 0)}</td>
                      <td className="tsr-action-col">
                        <button
                          type="button"
                          className="tsr-receipt-button"
                          aria-label={`View receipt ${t.receipt_number}`}
                          onClick={() => setSelectedReceipt(t)}
                        >
                          <Eye size={15} aria-hidden="true" /> <span>View Receipt</span>
                        </button>
                        {t.payment_status !== 'voided' && (
                          <button
                            type="button"
                            className="svd-inline-button"
                            aria-label={`Void receipt ${t.receipt_number}`}
                            onClick={() => setVoidTarget(t)}
                          >
                            <Ban size={14} aria-hidden="true" /> <span>Void Receipt</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {voidTarget && (
        <ServiceVoidDialog
          receipt={voidTarget}
          onClose={() => setVoidTarget(null)}
          onVoided={(updated) => {
            setVoidTarget(null)
            setTransactions((rows) =>
              rows.map((row) => row.id === updated.id ? updated : row)
            )
            loadTransactions()
          }}
        />
      )}
      {selectedReceiptModel && (
        <ReceiptDialog
          model={selectedReceiptModel}
          verificationLoading={settlement.loading}
          verificationError={settlement.error}
          dismissOnBackdrop={false}
          onClose={() => setSelectedReceipt(null)}
          onPrint={(setup) =>
            printReceipt(
              selectedReceiptModel,
              setReceiptPrintNotice,
              setup,
            )
          }
        />
      )}

      <ActionDialog
        open={Boolean(receiptPrintNotice)}
        title="Receipt printing"
        message={receiptPrintNotice}
        onConfirm={() => setReceiptPrintNotice('')}
      />
    </div>
  )
}