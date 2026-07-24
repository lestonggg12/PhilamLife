import React, { useEffect, useMemo, useState } from 'react'
import './TreasurerDashboard.css'
import { DollarSign, TrendingUp, AlertCircle, CheckCircle, Zap } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export default function TreasurerDashboard() {
  const [payments, setPayments] = useState([])
  const [expenses, setExpenses] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    setPageError('')

    const [paymentResult, expenseResult, serviceResult] = await Promise.all([
      supabase.from('payments').select('*').order('paid_at', { ascending: false }),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
      supabase.from('service_transactions').select('*').order('paid_at', { ascending: false }),
    ])

    const errors = [paymentResult.error, expenseResult.error, serviceResult.error].filter(Boolean)
    if (errors.length > 0) {
      setPageError(`Some financial records could not be loaded: ${errors.map((e) => e.message).join(' ')}`)
    }

    setPayments(paymentResult.data || [])
    setExpenses(expenseResult.data || [])
    setServiceTransactions(serviceResult.data || [])
    setLoading(false)
  }

  const summary = useMemo(() => {
    const now = new Date()
    const currentMonth = monthKey(now)

    const activePayments = payments.filter((p) => p.status !== 'Voided')
    const activeExpenses = expenses.filter((e) => e.status !== 'Voided')

    const totalDuesCollected = activePayments.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0)
    const totalAmenityRevenue = serviceTransactions.reduce((sum, t) => sum + (Number(t.amount_paid) || 0), 0)
    const totalExpenses = activeExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    const netPosition = totalDuesCollected + totalAmenityRevenue - totalExpenses

    const duesThisMonth = activePayments
      .filter((p) => p.paid_at && monthKey(new Date(p.paid_at)) === currentMonth)
      .reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0)

    const amenityThisMonth = serviceTransactions
      .filter((t) => t.service_date && monthKey(new Date(t.service_date)) === currentMonth)
      .reduce((sum, t) => sum + (Number(t.amount_paid) || 0), 0)

    const expensesThisMonth = activeExpenses
      .filter((e) => e.expense_date && monthKey(new Date(e.expense_date)) === currentMonth)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)

    const netThisMonth = duesThisMonth + amenityThisMonth - expensesThisMonth

    return {
      totalDuesCollected,
      totalAmenityRevenue,
      totalExpenses,
      netPosition,
      duesThisMonth,
      amenityThisMonth,
      expensesThisMonth,
      netThisMonth,
    }
  }, [payments, expenses, serviceTransactions])

  const recentActivity = useMemo(() => {
    const items = []

    payments.forEach((p) => {
      if (p.status === 'Voided') return
      items.push({
        id: `payment-${p.id}`,
        date: p.paid_at,
        title: 'Dues Payment',
        detail: `${p.homeowner_name} — ${p.block_name}, Lot ${p.lot_number}`,
        amount: Number(p.amount_paid) || 0,
        direction: 'in',
      })
    })

    serviceTransactions.forEach((t) => {
      items.push({
        id: `service-${t.id}`,
        date: t.paid_at,
        title: `Amenity — ${t.service_name}`,
        detail: `${t.customer_name} — ${t.block_name}, Lot ${t.lot_number}`,
        amount: Number(t.amount_paid) || 0,
        direction: 'in',
      })
    })

    expenses.forEach((e) => {
      if (e.status === 'Voided') return
      items.push({
        id: `expense-${e.id}`,
        date: e.created_at || e.expense_date,
        title: `Expense — ${e.category}`,
        detail: e.description,
        amount: Number(e.amount) || 0,
        direction: 'out',
      })
    })

    return items
      .filter((item) => item.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8)
  }, [payments, serviceTransactions, expenses])

  return (
    <div className="treas-treasurer-dashboard">
      <div className="treas-page-header">
        <h1 className="treas-page-title">Treasurer Dashboard</h1>
        <p className="treas-page-subtitle">Overview of dues, amenity revenue, and expenses.</p>
      </div>

      {pageError && (
        <p className="treas-error">
          <AlertCircle size={14} /> {pageError}
        </p>
      )}

      {/* Stats Grid */}
      <div className="treas-stats-grid">
        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Dues Collected</span>
            <div className="treas-stat-icon-box">
              <DollarSign size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">{loading ? '—' : peso.format(summary.totalDuesCollected)}</h3>
          <div className="treas-stat-footer">
            <TrendingUp size={12} />
            <span>{loading ? '—' : `${peso.format(summary.duesThisMonth)} this month`}</span>
          </div>
        </div>

        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Amenity Revenue</span>
            <div className="treas-stat-icon-box" style={{ background: 'rgba(20, 100, 160, 0.12)', color: '#1464a0' }}>
              <Zap size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">{loading ? '—' : peso.format(summary.totalAmenityRevenue)}</h3>
          <div className="treas-stat-footer">
            <TrendingUp size={12} />
            <span>{loading ? '—' : `${peso.format(summary.amenityThisMonth)} this month`}</span>
          </div>
        </div>

        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Total Expenses</span>
            <div className="treas-stat-icon-box" style={{ background: 'rgba(192, 57, 43, 0.12)', color: '#c0392b' }}>
              <AlertCircle size={18} />
            </div>
          </div>
          <h3 className="treas-stat-value">{loading ? '—' : peso.format(summary.totalExpenses)}</h3>
          <div className="treas-stat-footer">
            <span>{loading ? '—' : `${peso.format(summary.expensesThisMonth)} this month`}</span>
          </div>
        </div>

        <div className="treas-stat-card">
          <div className="treas-stat-top">
            <span className="treas-stat-label">Net Position</span>
            <div className="treas-stat-icon-box" style={{ background: 'rgba(26, 138, 96, 0.12)', color: '#1a8a60' }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <h3 className={`treas-stat-value ${summary.netPosition < 0 ? 'treas-negative' : ''}`}>
            {loading ? '—' : peso.format(summary.netPosition)}
          </h3>
          <div className="treas-stat-footer">
            <span>{loading ? '—' : `${peso.format(summary.netThisMonth)} this month`}</span>
          </div>
        </div>
      </div>

      {/* Bottom Grid - Recent Activity */}
      <div className="treas-bottom-grid">
        <div className="treas-transactions-panel treas-full-width">
          <h3 className="treas-section-title">Recent Activity</h3>

          {loading ? (
            <p className="treas-empty-state">Loading activity...</p>
          ) : recentActivity.length === 0 ? (
            <p className="treas-empty-state">No financial activity recorded yet.</p>
          ) : (
            recentActivity.map((item) => (
              <div className="treas-transaction-row" key={item.id}>
                <div
                  className="treas-transaction-icon"
                  style={
                    item.direction === 'in'
                      ? { background: 'rgba(26, 138, 96, 0.12)', color: '#1a8a60' }
                      : { background: 'rgba(192, 57, 43, 0.12)', color: '#c0392b' }
                  }
                >
                  {item.direction === 'in' ? '↓' : '↑'}
                </div>
                <div className="treas-transaction-content">
                  <p className="treas-transaction-title">{item.title}</p>
                  <p className="treas-transaction-detail">
                    {item.detail} · {dateFormatter.format(new Date(item.date))}
                  </p>
                </div>
                <div className={`treas-transaction-amount ${item.direction === 'out' ? 'negative' : ''}`}>
                  {item.direction === 'in' ? '+ ' : '- '}
                  {peso.format(item.amount)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}