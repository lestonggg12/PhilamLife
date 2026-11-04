import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './TreasurerDashboard.css'
import {
  AlertCircle,
  Bank,
  CheckCircle,
  CreditCard,
  DollarSign,
  FileText,
  RefreshCw,
  TrendingUp,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { loadTreasurerDashboard, summarizeTreasurerMonth } from '../lib/treasurerFinance'
import { useOrganization } from '../context/OrganizationContext'
import Skeleton from '../components/skeleton/Skeleton'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})


function manilaMonthKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}`
}

const amount = (row, keys) => {
  for (const key of keys) {
    const value = Number(row?.[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

const isVoided = (row) => String(row?.status || '').toLowerCase() === 'voided'


export default function TreasurerDashboard() {
  const { organization } = useOrganization()
  const [finance, setFinance] = useState({
    payments: [],
    monthly: null,
    expenses: [],
    services: [],
    properties: [],
    overdue: [],
    credits: null,
    adjustments: [],
    deposits: [],
    periods: [],
  })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  const request = useRef(0)
  useEffect(() => {
    loadDashboard()
    return () => { request.current += 1 }
  }, [])

  async function loadDashboard() {
    const sequence = ++request.current
    setLoading(true)
    setPageError('')
    try {
      const result = await loadTreasurerDashboard(supabase, `${manilaMonthKey()}-01`)
      if (sequence === request.current) setFinance(result)
    } catch (error) {
      if (sequence === request.current) setPageError(`Finance data is unavailable: ${error.message}`)
    } finally {
      if (sequence === request.current) setLoading(false)
    }
  }

  const summary = useMemo(() => {
    const month = summarizeTreasurerMonth(
      finance.monthly,
      finance.expenses,
      `${manilaMonthKey()}-01`
    )

    const { outstanding = 0, aging = { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days90Plus: 0 }, overdue = 0, overdueAccounts = 0 } = finance.agingSummary || {}

    return {
      ...month,
      outstanding,
      overdue,
      creditsHeld: Number(finance.credits?.active_credit_total) || 0,
      creditAccounts: Number(finance.credits?.active_credit_accounts) || 0,
      movedCredit: Number(finance.credits?.moved_credit_total) || 0,
      aging,
      overdueAccounts,
    }
  }, [finance])

  const exceptions = useMemo(() => {
    const unreconciledDeposits = finance.deposits.filter((row) => {
      const status = String(row.status || row.reconciliation_status || '').toLowerCase()
      return !['reconciled', 'cleared', 'completed', 'voided'].includes(status)
    }).length

    // account_adjustments has no status column — the closest available signal
    // for "needs review" is a non-reversed adjustment with no approval reference on file.
    const unreferencedAdjustments = finance.adjustments.filter((row) => {
      const isReversed = Boolean(row.reversed_at)
      const hasApproval = Boolean(String(row.approval_reference || '').trim())
      return !isReversed && !hasApproval
    }).length

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

    const currentPeriod = finance.periods.find((row) => {
      const status = String(row.status || '').toLowerCase()

      return !['closed', 'locked'].includes(status)
        && (!row.starts_on || row.starts_on <= today)
        && (!row.ends_on || row.ends_on >= today)
    })

    return { unreconciledDeposits, unreferencedAdjustments, currentPeriod }
  }, [finance.adjustments, finance.deposits, finance.periods])

  const recentActivity = useMemo(() => {
    const rows = []
    finance.payments.forEach((row) => {
      if (isVoided(row)) return
      rows.push({
        id: `payment-${row.id}`,
        date: row.paid_at || row.created_at,
        title: 'Homeowner payment',
        detail: `${row.homeowner_name || 'Homeowner'} · ${row.receipt_number || 'Payment receipt'}`,
        amount: amount(row, ['amount_paid', 'amount']),
        direction: 'in',
      })
    })
    finance.services.forEach((row) => rows.push({
      id: `service-${row.id}`,
      date: row.paid_at || row.created_at,
      title: row.service_name || 'Amenity payment',
      detail: row.customer_name || 'Amenity revenue',
      amount: amount(row, ['amount_paid', 'amount']),
      direction: 'in',
    }))
    finance.expenses.forEach((row) => {
      if (isVoided(row)) return
      rows.push({
        id: `expense-${row.id}`,
        date: row.expense_date ? `${row.expense_date}T12:00:00+08:00` : row.created_at,
        title: row.category || 'Expense',
        detail: row.description || row.payee || 'Operating expense',
        amount: amount(row, ['amount']),
        direction: 'out',
      })
    })
    return rows
      .filter((row) => row.date)
      .sort((left, right) => new Date(right.date) - new Date(left.date))
      .slice(0, 8)
  }, [finance.expenses, finance.payments, finance.services])

  const statCards = [
    { label: 'Collected this month', value: summary.collectedThisMonth, note: 'Dues, balance payments and fees', icon: TrendingUp, tone: 'green' },
    { label: 'Service collections this month', value: summary.servicesThisMonth, note: 'Amenities and service receipts', icon: Bank, tone: 'blue' },
    { label: 'Expenses this month', value: summary.expensesThisMonth, note: 'Active expenses dated this month', icon: DollarSign, tone: 'red' },
    { label: 'Outstanding receivables', value: summary.outstanding, note: `${summary.overdueAccounts} overdue account${summary.overdueAccounts === 1 ? '' : 's'}`, icon: FileText, tone: 'blue' },
    { label: 'Overdue balance', value: summary.overdue, note: 'Past-due amounts only; current excluded', icon: AlertCircle, tone: 'red' },
    { label: 'Advance credits held', value: summary.creditsHeld, note: `${summary.creditAccounts} active account${summary.creditAccounts === 1 ? '' : 's'}${summary.movedCredit > 0 ? ` + ${peso.format(summary.movedCredit)} on moved accounts` : ''}`, icon: DollarSign, tone: 'navy' },
    { label: 'Net recorded activity', value: summary.netThisMonth, note: 'Collections + services − dated expenses', icon: DollarSign, tone: summary.netThisMonth < 0 ? 'red' : 'navy' },
  ]

  return (
    <main className="treasurer-dashboard">
      <header className="treasurer-hero">
        <div>
          <span className="treasurer-eyebrow">Finance control center</span>
          <h1>Treasurer Dashboard</h1>
          <p>Receivables, collections, aging, exceptions, and recorded financial activity in one view.</p>
        </div>
        <button type="button" className="treasurer-refresh" onClick={loadDashboard} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'treas-spin-icon' : ''} />
          {loading ? 'Refreshing…' : 'Refresh data'}
        </button>
      </header>

      {pageError && <div className="treasurer-error"><AlertCircle size={17} />{pageError}</div>}

      <section className="treasurer-actions" aria-label="Treasurer actions">
        <Link to="/payments"><CreditCard size={18} /><span><strong>Record payment</strong><small>Save a payment and issue a receipt</small></span></Link>
        <Link to="/ledger"><FileText size={18} /><span><strong>Open ledger</strong><small>Balances and statements</small></span></Link>
        <Link to="/treasurer/expenses"><DollarSign size={18} /><span><strong>Record expense</strong><small>Maintain audit details</small></span></Link>
        <Link to="/reports"><Bank size={18} /><span><strong>Financial reports</strong><small>Collections and cash review</small></span></Link>
      </section>

      <section className="treasurer-stat-grid">
        {statCards.map(({ label, value, note, icon: Icon, tone }) => (
          <article className={`treasurer-stat-card tone-${tone}`} key={label}>
            <div className="treasurer-stat-heading"><span>{label}</span><Icon size={18} /></div>
            <strong>{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(value)}</strong>
            <small>{loading ? 'Loading finance data…' : pageError ? 'Financial data could not be verified' : note}</small>
          </article>
        ))}
      </section>

      <section className="treasurer-content-grid">
        <article className="treasurer-panel aging-panel">
          <div className="treasurer-panel-heading">
            <div><span className="treasurer-kicker">Receivables</span><h2>Aging overview</h2></div>
            <strong>{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(summary.outstanding)}</strong>
          </div>
          <div className="treasurer-aging-grid">
            {[
              ['Current', summary.aging.current, 'current'],
              ['1–30 days', summary.aging.days1To30, 'watch'],
              ['31–60 days', summary.aging.days31To60, 'warning'],
              ['61–90 days', summary.aging.days61To90, 'danger'],
              ['90+ days', summary.aging.days90Plus, 'critical'],
            ].map(([label, value, tone]) => (
              <div className={`treasurer-aging-item ${tone}`} key={label}>
                <span>{label}</span><strong>{loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(value)}</strong>
              </div>
            ))}
          </div>
          <Link className="treasurer-panel-link" to="/overdue-accounts">View overdue accounts →</Link>
        </article>

        <article className="treasurer-panel exception-panel">
          <div className="treasurer-panel-heading"><div><span className="treasurer-kicker">Attention</span><h2>Finance checks</h2></div></div>
          <div className="treasurer-check-list">
            <div><span className="check-icon warning"><AlertCircle size={16} /></span><p><strong>{loading ? 'Checking…' : pageError ? 'Unavailable' : `${summary.overdueAccounts} overdue accounts`}</strong><small>{loading ? 'Checking collections…' : pageError ? 'Collection totals could not be verified' : `${peso.format(summary.overdue)} needs collection follow-up`}</small></p></div>
            <div><span className="check-icon blue"><Bank size={16} /></span><p><strong>{loading ? 'Checking…' : pageError ? 'Unavailable' : `${exceptions.unreconciledDeposits} unreconciled deposits`}</strong><small>Match deposits with bank records</small></p></div>
            <div><span className="check-icon navy"><FileText size={16} /></span><p><strong>{loading ? 'Checking…' : pageError ? 'Unavailable' : `${exceptions.unreferencedAdjustments} adjustments without approval references`}</strong><small>Review documentation for any unreferenced adjustments</small></p></div>
            <div><span className="check-icon blue"><FileText size={16} /></span><p><strong>{loading ? 'Checking…' : pageError ? 'Unavailable' : exceptions.currentPeriod ? 'Accounting period open' : finance.periods.length === 0 ? 'Accounting periods not configured' : 'No open accounting period'}</strong><small>Accounting period status is informational</small></p></div>
          </div>
        </article>

        <article className="treasurer-panel activity-panel">
          <div className="treasurer-panel-heading"><div><span className="treasurer-kicker">Latest entries</span><h2>Recent financial activity</h2></div></div>
          {loading ? <div aria-busy="true"><Skeleton variant="rect" width="100%" height="48px" /><Skeleton variant="rect" width="100%" height="48px" /><Skeleton variant="rect" width="100%" height="48px" /><span className="skeleton-region-status" role="status">Loading</span></div> : pageError ? <p className="treasurer-empty">Activity is unavailable. Use Refresh data to retry.</p> : recentActivity.length === 0 ? <p className="treasurer-empty">No financial activity recorded yet.</p> : (
            <div className="treasurer-activity-list">
              {recentActivity.map((row) => (
                <div className="treasurer-activity-row" key={row.id}>
                  <span className={`activity-direction ${row.direction}`}>{row.direction === 'in' ? '↓' : '↑'}</span>
                  <div><strong>{row.title}</strong><small>{row.detail} · {organization.formatDate(row.date)}</small></div>
                  <b className={row.direction === 'out' ? 'expense' : ''}>{row.direction === 'out' ? '−' : '+'}{peso.format(row.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </main>
  )
}