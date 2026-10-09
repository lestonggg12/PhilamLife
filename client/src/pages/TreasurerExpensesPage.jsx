import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DollarSign, Plus, Trash2, AlertCircle, X } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import ActionDialog from '../components/ActionDialog'
import DateField from '../components/DateField'
import Select from '../components/Select'
import { useOrganization } from '../context/OrganizationContext'
import './TreasurerExpenses.css'

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

function monthLabel(monthKey) {
  if (!monthKey) return ''
  return new Intl.DateTimeFormat('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  }).format(new Date(`${monthKey}-15T12:00:00+08:00`))
}

function shiftMonth(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

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

// Shape expected by the custom <Select /> component.
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }))

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

// Money is stored in whole centavos; round typed/calculated amounts the same way
// so what staff see on screen is exactly what gets saved.
const toCents = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export default function TreasurerExpensesPage({ user: suppliedUser }) {
  const { organization } = useOrganization()
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [expenses, setExpenses] = useState([])
  const [selectedMonth, setSelectedMonth] = useState(manilaMonthKey())
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [monthMenuMounted, setMonthMenuMounted] = useState(false)
  const [monthMenuVisible, setMonthMenuVisible] = useState(false)
  const [monthMenuPosition, setMonthMenuPosition] = useState(null)
  const monthPickerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [voidingId, setVoidingId] = useState(null)
  const [pendingVoid, setPendingVoid] = useState(null)
  const [voidError, setVoidError] = useState('')

  const recorderName =
    currentUser?.full_name || currentUser?.name || currentUser?.email || 'Staff member'

  useEffect(() => {
    loadExpenses()
    resolveCurrentUser()
  }, [])

  useEffect(() => {
    if (!monthMenuMounted) {
      setMonthMenuPosition(null)
      return undefined
    }

    function positionMonthMenu() {
      const picker = monthPickerRef.current
      if (!picker) return

      const rect = picker.getBoundingClientRect()
      const menuWidth = 242
      const menuHeight = 270
      const gap = 8
      const left = Math.max(12, Math.min(
        rect.right - 36 - menuWidth,
        window.innerWidth - menuWidth - 12,
      ))
      const top = rect.bottom + gap + menuHeight > window.innerHeight
        ? Math.max(12, rect.top - menuHeight - gap)
        : rect.bottom + gap

      setMonthMenuPosition({ left, top })
    }

    positionMonthMenu()
    window.addEventListener('resize', positionMonthMenu)
    window.addEventListener('scroll', positionMonthMenu, true)
    return () => {
      window.removeEventListener('resize', positionMonthMenu)
      window.removeEventListener('scroll', positionMonthMenu, true)
    }
  }, [monthMenuMounted])

  // Close the month menu when clicking outside of it.
  // (Renamed from closeMonthPicker: the old name shadowed the real function
  // and made it call itself with no event.)
  useEffect(() => {
    function handleOutsideClick(event) {
      if (!monthPickerRef.current?.contains(event.target)) closeMonthPicker()
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  function openMonthPicker() {
    setMonthMenuMounted(true)
    setMonthPickerOpen(true)
  }

  function closeMonthPicker() {
    setMonthPickerOpen(false)
    setMonthMenuVisible(false)
  }

  useEffect(() => {
    if (monthPickerOpen) return undefined
    if (monthMenuVisible) return undefined
    if (!monthMenuMounted) return undefined

    const timer = window.setTimeout(() => setMonthMenuMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [monthPickerOpen, monthMenuVisible, monthMenuMounted])

  useEffect(() => {
    if (!monthMenuMounted) return undefined

    const frame = requestAnimationFrame(() => setMonthMenuVisible(monthPickerOpen))
    return () => cancelAnimationFrame(frame)
  }, [monthMenuMounted, monthPickerOpen])

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

    const { data, error } = await fetchAll(() => supabase
      .from('expenses')
      .select('*')
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }))

    if (error) {
      setPageError(`Expenses could not be loaded: ${error.message}`)
    }

    setExpenses(data || [])
    setLoading(false)
  }

  const summary = useMemo(() => {
    const activeExpenses = expenses.filter((e) => e.status !== 'Voided')
    const selectedMonthExpenses = activeExpenses.filter((e) => (e.expense_date || '').startsWith(selectedMonth))

    const totalAllTime = activeExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
    const totalSelectedMonth = selectedMonthExpenses
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)

    const byCategory = new Map()
    selectedMonthExpenses.forEach((e) => {
      const key = e.category || 'Uncategorized'
      byCategory.set(key, (byCategory.get(key) || 0) + (Number(e.amount) || 0))
    })

    const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]

    return {
      totalAllTime,
      totalSelectedMonth,
      count: selectedMonthExpenses.length,
      topCategory: topCategory ? { name: topCategory[0], amount: topCategory[1] } : null,
    }
  }, [expenses, selectedMonth])

  const visibleExpenses = useMemo(
    () => expenses.filter((expense) => (expense.expense_date || '').startsWith(selectedMonth)),
    [expenses, selectedMonth],
  )

  const selectedYear = Number(selectedMonth.slice(0, 4))
  const selectedMonthIndex = Number(selectedMonth.slice(5, 7)) - 1

  function selectMonth(year, monthIndex) {
    setSelectedMonth(`${year}-${String(monthIndex + 1).padStart(2, '0')}`)
    closeMonthPicker()
  }

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

    const amount = toCents(form.amount)
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
    if (!form.category) {
      setFormError('Please select a category.')
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

  function requestVoid(expense) {
    if (expense.status === 'Voided') return
    setPendingVoid(expense)
  }

  async function handleVoid(expense) {
    setPendingVoid(null)
    setVoidingId(expense.id)

    const { data, error } = await supabase
      .from('expenses')
      .update({ status: 'Voided' })
      .eq('id', expense.id)
      .select('*')
      .single()

    setVoidingId(null)

    if (error) {
      setVoidError(`Could not void expense: ${error.message}`)
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

  const recordedExpenses = visibleExpenses.filter((expense) => expense.status !== 'Voided')
  const voidedExpenses = visibleExpenses.filter((expense) => expense.status === 'Voided')

  function renderExpenseTable(records, includeActions = true) {
    return (
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
              {includeActions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {records.map((expense) => (
              <tr key={expense.id} className={expense.status === 'Voided' ? 'tex-row-voided' : ''}>
                <td>{expense.expense_date ? organization.formatDate(expense.expense_date) : '—'}</td>
                <td><span className="tex-category-pill">{expense.category}</span></td>
                <td>{expense.description}</td>
                <td>{expense.reference_number || '—'}</td>
                <td>{expense.recorded_by_name || '—'}</td>
                <td>
                  <span className={`tex-status-pill ${expense.status === 'Voided' ? 'tex-status-voided' : 'tex-status-completed'}`}>
                    {expense.status}
                  </span>
                </td>
                <td className="tex-amount-col tex-amount">{peso.format(Number(expense.amount) || 0)}</td>
                {includeActions && (
                  <td>
                    <button
                      className="tex-void-btn"
                      onClick={() => requestVoid(expense)}
                      disabled={expense.status === 'Voided' || voidingId === expense.id}
                      title="Void expense"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
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
          <span className="tex-stat-label">Total {monthLabel(selectedMonth)}</span>
          <h3 className="tex-stat-value">{loading ? '—' : peso.format(summary.totalSelectedMonth)}</h3>
        </div>
        <div className="tex-stat-card">
          <span className="tex-stat-label">Total Recorded</span>
          <h3 className="tex-stat-value">{loading ? '—' : peso.format(summary.totalAllTime)}</h3>
        </div>
        <div className="tex-stat-card">
          <span className="tex-stat-label">{monthLabel(selectedMonth)} Entries</span>
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
        <div className="tex-history-header">
          <div>
            <h3 className="tex-section-title">Expense History</h3>
            <p className="tex-history-caption">Select a month to view its archived expense records.</p>
          </div>
          <div className="tex-month-picker" ref={monthPickerRef}>
            <button
              type="button"
              className="tex-month-nav"
              onClick={() => setSelectedMonth((month) => shiftMonth(month, -1))}
              aria-label="View previous month"
            >
              ‹
            </button>
            <button
              type="button"
              className={`tex-month-trigger ${monthPickerOpen ? 'is-open' : ''}`}
              onClick={() => (monthPickerOpen ? closeMonthPicker() : openMonthPicker())}
              aria-expanded={monthPickerOpen}
              aria-haspopup="dialog"
            >
              <span className="tex-month-trigger-icon" aria-hidden="true">▣</span>
              <span>{MONTHS[selectedMonthIndex]} {selectedYear}</span>
              <span
                className="tex-month-trigger-chevron"
                role="button"
                tabIndex={0}
                aria-label={monthPickerOpen ? 'Close month selector' : 'Open month selector'}
                onClick={(event) => {
                  event.stopPropagation()
                  monthPickerOpen ? closeMonthPicker() : openMonthPicker()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    monthPickerOpen ? closeMonthPicker() : openMonthPicker()
                  }
                }}
              />
            </button>
            <button
              type="button"
              className="tex-month-nav"
              onClick={() => setSelectedMonth((month) => shiftMonth(month, 1))}
              aria-label="View next month"
            >
              ›
            </button>
            {monthMenuMounted && (
              <div
                className={`tex-month-menu ${monthMenuVisible ? 'is-visible' : ''}`}
                role="dialog"
                aria-label="Select expense history month"
                style={monthMenuPosition || undefined}
              >
                <div className="tex-month-menu-header">
                  <button type="button" className="tex-year-nav" onClick={() => setSelectedMonth(`${selectedYear - 1}-${String(selectedMonthIndex + 1).padStart(2, '0')}`)} aria-label="Previous year">‹</button>
                  <strong>{selectedYear}</strong>
                  <button type="button" className="tex-year-nav" onClick={() => setSelectedMonth(`${selectedYear + 1}-${String(selectedMonthIndex + 1).padStart(2, '0')}`)} aria-label="Next year">›</button>
                </div>
                <div className="tex-month-grid">
                  {MONTHS.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      className={index === selectedMonthIndex ? 'is-selected' : ''}
                      onClick={() => selectMonth(selectedYear, index)}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>
                <button type="button" className="tex-current-month" onClick={() => selectMonth(Number(manilaMonthKey().slice(0, 4)), Number(manilaMonthKey().slice(5, 7)) - 1)}>
                  Jump to current month
                </button>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="tex-state">Loading expenses...</div>
        ) : visibleExpenses.length === 0 ? (
          <div className="tex-state">
            {expenses.length === 0
              ? 'No expenses recorded yet. Click "Record Expense" to add one.'
              : `No expenses were recorded in ${monthLabel(selectedMonth)}. Choose another month to view archived history.`}
          </div>
        ) : (
          <>
            {recordedExpenses.length > 0 && (
              <>
                <h4 className="tex-history-subtitle">Recorded Expenses</h4>
                {renderExpenseTable(recordedExpenses)}
              </>
            )}

            {voidedExpenses.length > 0 && (
              <>
                <h4 className="tex-history-subtitle tex-history-subtitle-voided">Voided Expenses</h4>
                <p className="tex-history-note">Voided expenses are kept for audit history and excluded from totals.</p>
                {renderExpenseTable(voidedExpenses, false)}
              </>
            )}
          </>
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
                {/* Custom controls are NOT wrapped in <label>: a click inside
                    the popup would be forwarded to the trigger button and
                    reopen it right after picking a value. */}
                <div className="tex-field">
                  <span className="tex-field-label">Date</span>
                  <DateField
                    value={form.expense_date}
                    onChange={(key) => updateForm('expense_date', key)}
                    placeholder="Select date"
                    ariaLabel="Expense date"
                  />
                </div>

                <div className="tex-field">
                  <span className="tex-field-label">Category</span>
                  <Select
                    value={form.category}
                    options={CATEGORY_OPTIONS}
                    onChange={(value) => updateForm('category', value)}
                    ariaLabel="Category"
                  />
                </div>
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
                    onWheel={(event) => event.currentTarget.blur()}
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

      <ActionDialog
        open={!!pendingVoid}
        title="Void This Expense?"
        message={
          pendingVoid
            ? `${pendingVoid.category} — ${peso.format(pendingVoid.amount)}\n${pendingVoid.description}\n\nVoided expenses stay on record but are excluded from totals.`
            : ''
        }
        confirmLabel="Void Expense"
        tone="danger"
        onConfirm={() => handleVoid(pendingVoid)}
        onCancel={() => setPendingVoid(null)}
      />

      <ActionDialog
        open={!!voidError}
        title="Could Not Void Expense"
        message={voidError}
        onConfirm={() => setVoidError('')}
      />
    </div>
  )
}