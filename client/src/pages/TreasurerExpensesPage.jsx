import React, { useEffect, useMemo, useState } from 'react'
import { DollarSign, Plus, Trash2, AlertCircle, X } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import './TreasurerExpenses.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
})

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const CATEGORIES = [
  'Utilities',
  'Maintenance & Repairs',
  'Security',
  'Salaries & Honoraria',
  'Supplies',
  'Waste Management',
  'Insurance',
  'Events & Community',
  'Professional Fees',
  'Other',
]

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function emptyForm() {
  return {
    expense_date: todayISO(),
    category: CATEGORIES[0],
    description: '',
    amount: '',
    reference_number: '',
  }
}

export default function TreasurerExpensesPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [voidingId, setVoidingId] = useState(null)

  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadExpenses()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) return

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadExpenses() {
    setLoading(true)
    setPageError('')

    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      setPageError(`Expenses could not be loaded: ${error.message}`)
    }

    setExpenses(data || [])
    setLoading(false)
  }

  const summary = useMemo(() => {
    const now = new Date()
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const activeExpenses = expenses.filter((e) => e.status !== 'Voided')

    const totalAllTime = activeExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    const totalThisMonth = activeExpenses
      .filter((e) => (e.expense_date || '').startsWith(currentMonthKey))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)

    const byCategory = new Map()
    activeExpenses.forEach((e) => {
      const key = e.category || 'Uncategorized'
      byCategory.set(key, (byCategory.get(key) || 0) + (Number(e.amount) || 0))
    })

    const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]

    return {
      totalAllTime,
      totalThisMonth,
      count: activeExpenses.length,
      topCategory: topCategory ? { name: topCategory[0], amount: topCategory[1] } : null,
    }
  }, [expenses])

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function openForm() {
    setForm(emptyForm())
    setFormError('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')

    if (!currentUser?.id) {
      setFormError('Your user profile could not be verified. Please sign in again.')
      return
    }

    const amount = Number(form.amount)
    if (!form.description.trim()) {
      setFormError('Please enter a description.')
      return
    }
    if (!amount || amount <= 0) {
      setFormError('Please enter a valid amount greater than zero.')
      return
    }
    if (!form.expense_date) {
      setFormError('Please select a date.')
      return
    }

    setSaving(true)

    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      description: form.description.trim(),
      amount,
      reference_number: form.reference_number.trim() || null,
      recorded_by: currentUser.id,
      recorded_by_name: recorderName,
    }

    const { data, error } = await supabase
      .from('expenses')
      .insert(payload)
      .select('*')
      .single()

    setSaving(false)

    if (error) {
      setFormError(error.message)
      return
    }

    setExpenses((current) => [data, ...current])
    setShowForm(false)

    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: currentUser.id,
      action: 'Expense Recorded',
      target: `${data.category} — ${peso.format(data.amount)} (${recorderName})`,
    })

    if (activityError) {
      console.warn('Expense saved, but activity logging failed:', activityError.message)
    }
  }

  async function handleVoid(expense) {
    if (expense.status === 'Voided') return

    const confirmed = window.confirm(
      `Void this expense?\n\n${expense.category} — ${peso.format(expense.amount)}\n${expense.description}\n\nVoided expenses stay on record but are excluded from totals.`,
    )
    if (!confirmed) return

    setVoidingId(expense.id)

    const { data, error } = await supabase
      .from('expenses')
      .update({ status: 'Voided' })
      .eq('id', expense.id)
      .select('*')
      .single()

    setVoidingId(null)

    if (error) {
      window.alert(`Could not void expense: ${error.message}`)
      return
    }

    setExpenses((current) => current.map((e) => (e.id === expense.id ? data : e)))

    if (currentUser?.id) {
      await supabase.from('activity_log').insert({
        user_id: currentUser.id,
        action: 'Expense Voided',
        target: `${expense.category} — ${peso.format(expense.amount)} (${recorderName})`,
      })
    }
  }

  return (
    <div className="tex-page">
      <div className="tex-page-header">
        <div>
          <h1 className="tex-page-title">Expenses</h1>
          <p className="tex-page-subtitle">Record and track association operating expenses.</p>
        </div>
        <button className="tex-add-btn" onClick={openForm}>
          <Plus size={16} /> Record Expense
        </button>
      </div>

      {pageError && (
        <p className="tex-error">
          <AlertCircle size={14} /> {pageError}
        </p>
      )}

      <div className="tex-stats-grid">
        <div className="tex-stat-card">
          <span className="tex-stat-label">Total This Month</span>
          <h3 className="tex-stat-value">{loading ? '—' : peso.format(summary.totalThisMonth)}</h3>
        </div>
        <div className="tex-stat-card">
          <span className="tex-stat-label">Total Recorded</span>
          <h3 className="tex-stat-value">{loading ? '—' : peso.format(summary.totalAllTime)}</h3>
        </div>
        <div className="tex-stat-card">
          <span className="tex-stat-label">Entries</span>
          <h3 className="tex-stat-value">{loading ? '—' : summary.count}</h3>
        </div>
        <div className="tex-stat-card">
          <span className="tex-stat-label">Top Category</span>
          <h3 className="tex-stat-value tex-stat-value-sm">
            {loading || !summary.topCategory ? '—' : summary.topCategory.name}
          </h3>
        </div>
      </div>

      <div className="tex-table-panel">
        <h3 className="tex-section-title">Expense History</h3>

        {loading ? (
          <div className="tex-state">Loading expenses...</div>
        ) : expenses.length === 0 ? (
          <div className="tex-state">No expenses recorded yet. Click "Record Expense" to add one.</div>
        ) : (
          <div className="tex-table-wrap">
            <table className="tex-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Reference</th>
                  <th>Recorded By</th>
                  <th>Status</th>
                  <th className="tex-amount-col">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => {
                  const isVoided = expense.status === 'Voided'
                  return (
                    <tr key={expense.id} className={isVoided ? 'tex-row-voided' : ''}>
                      <td>{expense.expense_date ? dateFormatter.format(new Date(expense.expense_date)) : '—'}</td>
                      <td><span className="tex-category-pill">{expense.category}</span></td>
                      <td>{expense.description}</td>
                      <td>{expense.reference_number || '—'}</td>
                      <td>{expense.recorded_by_name || '—'}</td>
                      <td>
                        <span className={`tex-status-pill ${isVoided ? 'tex-status-voided' : 'tex-status-completed'}`}>
                          {expense.status}
                        </span>
                      </td>
                      <td className="tex-amount-col tex-amount">{peso.format(Number(expense.amount) || 0)}</td>
                      <td>
                        <button
                          className="tex-void-btn"
                          onClick={() => handleVoid(expense)}
                          disabled={isVoided || voidingId === expense.id}
                          title={isVoided ? 'Already voided' : 'Void expense'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="tex-modal-overlay" onClick={closeForm}>
          <div className="tex-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tex-modal-close" onClick={closeForm} disabled={saving}>
              <X size={20} />
            </button>

            <div className="tex-modal-header">
              <DollarSign size={18} />
              <h2>Record Expense</h2>
            </div>

            <form onSubmit={handleSubmit} className="tex-form">
              <div className="tex-form-row">
                <label>
                  Date
                  <input
                    type="date"
                    value={form.expense_date}
                    onChange={(e) => updateForm('expense_date', e.target.value)}
                    required
                  />
                </label>

                <label>
                  Category
                  <select
                    value={form.category}
                    onChange={(e) => updateForm('category', e.target.value)}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                Description
                <input
                  type="text"
                  placeholder="e.g. Electricity bill for clubhouse"
                  value={form.description}
                  onChange={(e) => updateForm('description', e.target.value)}
                  required
                />
              </label>

              <div className="tex-form-row">
                <label>
                  Amount (₱)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => updateForm('amount', e.target.value)}
                    required
                  />
                </label>

                <label>
                  Reference No. (optional)
                  <input
                    type="text"
                    placeholder="OR / invoice number"
                    value={form.reference_number}
                    onChange={(e) => updateForm('reference_number', e.target.value)}
                  />
                </label>
              </div>

              {formError && <p className="tex-form-error">{formError}</p>}

              <div className="tex-form-footer">
                <button type="button" className="tex-btn tex-btn-secondary" onClick={closeForm} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="tex-btn tex-btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}