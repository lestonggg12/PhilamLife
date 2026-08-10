import React, { useEffect, useMemo, useState } from 'react'
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
import { useOrganization } from '../context/OrganizationContext'
import { computeLateFee } from '../lib/latepenalty'

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

async function optionalRows(table, orderColumn) {
  let query = supabase.from(table).select('*')
  if (orderColumn) query = query.order(orderColumn, { ascending: false })
  const { data, error } = await query
  return { table, data: data || [], error }
}

export default function TreasurerDashboard() {
  const { organization } = useOrganization()
  const [finance, setFinance] = useState({
    payments: [],
    expenses: [],
    services: [],
    accounts: [],
    adjustments: [],
    deposits: [],
    periods: [],
  })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    setPageError('')

    const results = await Promise.all([
      optionalRows('payments', 'paid_at'),
      optionalRows('expenses', 'expense_date'),
      optionalRows('service_transactions', 'paid_at'),
      optionalRows('properties', 'homeowner_name'),
      supabase.from('system_settings').select('dues_amount, due_day, grace_period_days, late_penalty').eq('id', 1).maybeSingle()
        .then(({ data, error }) => ({ table: 'system_settings', data: data ? [data] : [], error })),
      optionalRows('account_adjustments', 'created_at'),
      optionalRows('bank_deposits', 'recorded_at'),
      optionalRows('accounting_periods', 'starts_on'),
    ])

    const byTable = Object.fromEntries(results.map((result) => [result.table, result.data]))
    const criticalError = results.find(
      (result) =>
        result.error &&
        ['payments', 'expenses', 'properties'].includes(result.table),
    )

    if (criticalError) {
      setPageError(`Finance data could not be fully loaded: ${criticalError.error.message}`)
    }

    setFinance({
      payments: byTable.payments || [],
      expenses: byTable.expenses || [],
      services: byTable.service_transactions || [],
      properties: byTable.properties || [],
      settings: (byTable.system_settings || [])[0] || null,
      adjustments: byTable.account_adjustments || [],
      deposits: byTable.bank_deposits || [],
      periods: byTable.accounting_periods || [],
    })
    setLoading(false)
  }

  const summary = useMemo(() => {
    const currentMonth = manilaMonthKey()
    const activePayments = finance.payments.filter((row) => !isVoided(row))
    const activeExpenses = finance.expenses.filter((row) => !isVoided(row))

    const collectedThisMonth = activePayments
      .filter((row) => row.paid_at && manilaMonthKey(row.paid_at) === currentMonth)
      .reduce((sum, row) => sum + amount(row, ['amount_paid', 'amount']), 0)

    const servicesThisMonth = finance.services
      .filter((row) => row.paid_at && manilaMonthKey(row.paid_at) === currentMonth)
      .reduce((sum, row) => sum + amount(row, ['amount_paid', 'amount']), 0)

    const expensesThisMonth = activeExpenses
      .filter((row) => String(row.expense_date || row.created_at || '').slice(0, 7) === currentMonth)
      .reduce((sum, row) => sum + amount(row, ['amount']), 0)

    // Computed the same way as the Overdue Accounts page: directly from
    // payment history + Due Day/Grace Period/Late Penalty settings, since
    // homeowner_ledger_summary (posted-charge based) is not populated.
    const dueDay = Number(finance.settings?.due_day) || 5
    const gracePeriodDays = Number(finance.settings?.grace_period_days) || 0
    const latePenalty = Number(finance.settings?.late_penalty) || 0
    const duesAmount = Number(finance.settings?.dues_amount) || 0

    const accountRows = finance.properties.map((property) => {
      const propertyPayments = activePayments
        .filter((p) => Number(p.property_id) === Number(property.id))
        .sort((a, b) => new Date(b.paid_at || 0) - new Date(a.paid_at || 0))
      const latest = propertyPayments[0]
      const balance = latest ? Number(latest.remaining_balance) || 0 : duesAmount
      const lateFee = computeLateFee({ balance, dueDay, gracePeriodDays, latePenalty })
      return { balance, isOverdue: lateFee.isOverdue, daysOverdue: lateFee.daysOverdue }
    })

    const outstanding = accountRows.reduce((sum, row) => sum + row.balance, 0)
    const aging = accountRows.reduce(
      (result, row) => {
        if (row.balance <= 0) return result
        if (!row.isOverdue) return { ...result, current: result.current + row.balance }
        if (row.daysOverdue <= 30) return { ...result, days1To30: result.days1To30 + row.balance }
        if (row.daysOverdue <= 60) return { ...result, days31To60: result.days31To60 + row.balance }
        if (row.daysOverdue <= 90) return { ...result, days61To90: result.days61To90 + row.balance }
        return { ...result, days90Plus: result.days90Plus + row.balance }
      },
      { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days90Plus: 0 },
    )

    return {
      collectedThisMonth,
      servicesThisMonth,
      expensesThisMonth,
      netThisMonth: collectedThisMonth + servicesThisMonth - expensesThisMonth,
      outstanding,
      overdue: aging.days1To30 + aging.days31To60 + aging.days61To90 + aging.days90Plus,
      aging,
      overdueAccounts: accountRows.filter((row) => row.isOverdue).length,
    }
  }, [finance])

  const exceptions = useMemo(() => {
    const unreconciledDeposits = finance.deposits.filter((row) => {
      const status = String(row.status || row.reconciliation_status || '').toLowerCase()
      return !['reconciled', 'cleared', 'completed'].includes(status)
    }).length

    const pendingAdjustments = finance.adjustments.filter((row) => {
      const status = String(row.status || 'posted').toLowerCase()
      return ['pending', 'draft', 'awaiting approval'].includes(status)
    }).length

    const currentPeriod = finance.periods.find((row) => {
      const status = String(row.status || '').toLowerCase()
      return !['closed', 'locked'].includes(status)
    })

    return { unreconciledDeposits, pendingAdjustments, currentPeriod }
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
        date: row.created_at || row.expense_date,
        title: row.category || 'Expense',
        detail: row.description || row.payee || 'Operating expense',
        amount: amount(row, ['amount']),
        direction: 'out',
      })
    })
    return rows
      .filter((row) => row.date)
      .sort((left, right) => new Date(right.date) - new Date(left.date))
      .slice(0, 7)
  }, [finance.expenses, finance.payments, finance.services])

  const statCards = [
    { label: 'Collected this month', value: summary.collectedThisMonth, note: 'Allocated homeowner payments', icon: TrendingUp, tone: 'green' },
    { label: 'Outstanding receivables', value: summary.outstanding, note: `${summary.overdueAccounts} overdue account${summary.overdueAccounts === 1 ? '' : 's'}`, icon: FileText, tone: 'blue' },
    { label: 'Overdue balance', value: summary.overdue, note: 'Across all aging buckets', icon: AlertCircle, tone: 'red' },
    { label: 'Net cash activity', value: summary.netThisMonth, note: 'Dues + amenities − expenses', icon: DollarSign, tone: summary.netThisMonth < 0 ? 'red' : 'navy' },
  ]

  return (
    <main className="treasurer-dashboard">
      <header className="treasurer-hero">
        <div>
          <span className="treasurer-eyebrow">Finance control center</span>
          <h1>Treasurer Dashboard</h1>
          <p>Receivables, collections, aging, exceptions, and cash activity in one view.</p>
        </div>
        <button type="button" className="treasurer-refresh" onClick={loadDashboard} disabled={loading}>
          <RefreshCw size={16} /> {loading ? 'Refreshing…' : 'Refresh data'}
        </button>
      </header>

      {pageError && <div className="treasurer-error"><AlertCircle size={17} />{pageError}</div>}

      <section className="treasurer-actions" aria-label="Treasurer actions">
        <Link to="/payments"><CreditCard size={18} /><span><strong>Record payment</strong><small>Post and allocate FIFO</small></span></Link>
        <Link to="/ledger"><FileText size={18} /><span><strong>Open ledger</strong><small>Balances and statements</small></span></Link>
        <Link to="/treasurer/expenses"><DollarSign size={18} /><span><strong>Record expense</strong><small>Maintain audit details</small></span></Link>
        <Link to="/reports"><Bank size={18} /><span><strong>Financial reports</strong><small>Collections and cash review</small></span></Link>
      </section>

      <section className="treasurer-stat-grid">
        {statCards.map(({ label, value, note, icon: Icon, tone }) => (
          <article className={`treasurer-stat-card tone-${tone}`} key={label}>
            <div className="treasurer-stat-heading"><span>{label}</span><Icon size={18} /></div>
            <strong>{loading ? '—' : peso.format(value)}</strong>
            <small>{loading ? 'Loading finance data…' : note}</small>
          </article>
        ))}
      </section>

      <section className="treasurer-content-grid">
        <article className="treasurer-panel aging-panel">
          <div className="treasurer-panel-heading">
            <div><span className="treasurer-kicker">Receivables</span><h2>Aging overview</h2></div>
            <strong>{peso.format(summary.outstanding)}</strong>
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
                <span>{label}</span><strong>{loading ? '—' : peso.format(value)}</strong>
              </div>
            ))}
          </div>
          <Link className="treasurer-panel-link" to="/ledger">Review homeowner accounts →</Link>
        </article>

        <article className="treasurer-panel exception-panel">
          <div className="treasurer-panel-heading"><div><span className="treasurer-kicker">Attention</span><h2>Finance checks</h2></div></div>
          <div className="treasurer-check-list">
            <div><span className="check-icon warning"><AlertCircle size={16} /></span><p><strong>{summary.overdueAccounts} overdue accounts</strong><small>{peso.format(summary.overdue)} needs collection follow-up</small></p></div>
            <div><span className="check-icon blue"><Bank size={16} /></span><p><strong>{exceptions.unreconciledDeposits} unreconciled deposits</strong><small>Match deposits with bank records</small></p></div>
            <div><span className="check-icon navy"><FileText size={16} /></span><p><strong>{exceptions.pendingAdjustments} pending adjustments</strong><small>{exceptions.currentPeriod ? 'Accounting period is open' : 'No open accounting period found'}</small></p></div>
          </div>
        </article>

        <article className="treasurer-panel activity-panel">
          <div className="treasurer-panel-heading"><div><span className="treasurer-kicker">Latest entries</span><h2>Recent cash activity</h2></div></div>
          {loading ? <p className="treasurer-empty">Loading activity…</p> : recentActivity.length === 0 ? <p className="treasurer-empty">No financial activity recorded yet.</p> : (
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