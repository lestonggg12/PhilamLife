import { notifySuccess } from '../lib/actionFeedback'
import { expenseDateControlError, expenseEvidenceControlError } from '../lib/expenseEntryControls'
import { financialSubmissionIntent, assertFinancialSubmissionMatches, requireUnchangedFinancialAttempt } from '../lib/financialSubmissionIntegrity'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, DollarSign, FileText, Plus, Trash2, AlertCircle, X } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { parseExpenseAmount, isValidExpenseDate, isVoidedExpense, summarizeExpenses } from '../lib/expenseSummary'
import ExpenseVoidDialog from './ExpenseVoidDialog'
import { recordExpense, voidExpense } from '../lib/treasurerFinance'
import DateField from '../components/DateField'
import Select from '../components/Select'
import { useOrganization } from '../context/OrganizationContext'
import './TreasurerExpenses.css'
import { ReceiptText } from 'lucide-react'
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

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

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

  return `${date.getUTCFullYear()}-${String(
    date.getUTCMonth() + 1,
  ).padStart(2, '0')}`
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

const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({
  value: category,
  label: category,
}))

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
  }).format(new Date())
}

function emptyForm() {
  return {
    expense_date: todayISO(),
    category: CATEGORIES[0],
    description: '',
    amount: '',
    reference_number: '',
    supporting_note: '',
    backdate_reason: '',
  }
}

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
  // Refs close the same-tick double-click gap before React re-renders.
  const savingRef = useRef(false)
  const [expenseSubmissionKey, setExpenseSubmissionKey] = useState(null)
  const expenseAttemptRef = useRef(null)
  const voidingRef = useRef(false)

  const [voidingId, setVoidingId] = useState(null)
  const [pendingVoid, setPendingVoid] = useState(null)
  const [voidError, setVoidError] = useState('')
  const [voidReason, setVoidReason] = useState('')

  const role = String(currentUser?.role || '').trim().toLowerCase()

  const canRecordExpenses = currentUser?.is_active !== false && role === 'treasurer'
  const canVoidExpenses = canRecordExpenses
const isReadOnly = !canRecordExpenses

  const recorderName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.email ||
    'Staff member'

  useEffect(() => {
    loadExpenses()
    resolveCurrentUser()
    // Initial load only; loadExpenses and resolveCurrentUser are
    // intentionally invoked once when this page mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      const left = Math.max(
        12,
        Math.min(
          rect.right - 36 - menuWidth,
          window.innerWidth - menuWidth - 12,
        ),
      )

      const top =
        rect.bottom + gap + menuHeight > window.innerHeight
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

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!monthPickerRef.current?.contains(event.target) && !event.target.closest?.('.tex-month-menu')) {
        closeMonthPicker()
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
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
    if (monthPickerOpen || monthMenuVisible || !monthMenuMounted) {
      return undefined
    }

    const timer = window.setTimeout(
      () => setMonthMenuMounted(false),
      180,
    )

    return () => window.clearTimeout(timer)
  }, [monthPickerOpen, monthMenuVisible, monthMenuMounted])

  useEffect(() => {
    if (!monthMenuMounted) return undefined

    const frame = requestAnimationFrame(() => {
      setMonthMenuVisible(monthPickerOpen)
    })

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

    if (!profileError && profile) {
      setCurrentUser(profile)
    }
  }

  async function loadExpenses() {
    setLoading(true)
    setPageError('')
    try {
      const { data, error } = await fetchAll(() =>
        supabase
          .from('expenses')
          .select('*')
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false }),
      )
      if (error) throw error
      if (!Array.isArray(data)) throw new Error('Expense data is incomplete.')
      // Validate all money before replacing previously verified records.
      summarizeExpenses(data, selectedMonth)
      setExpenses(data)
    } catch (error) {
      setPageError(`Expenses could not be loaded: ${error?.message || 'Connection failed.'}`)
      // Keep the last verified dataset instead of falsely showing an empty ledger.
    } finally {
      setLoading(false)
    }
  }

  const summary = useMemo(() => summarizeExpenses(expenses, selectedMonth), [expenses, selectedMonth])

  const visibleExpenses = useMemo(
    () =>
      expenses.filter((expense) =>
        (expense.expense_date || '').startsWith(selectedMonth),
      ),
    [expenses, selectedMonth],
  )

  const selectedYear = Number(selectedMonth.slice(0, 4))
  const selectedMonthIndex = Number(selectedMonth.slice(5, 7)) - 1

  function selectMonth(year, monthIndex) {
    setSelectedMonth(
      `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    )
    closeMonthPicker()
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function openForm() {
    if (!canRecordExpenses) return

    expenseAttemptRef.current = null
    setExpenseSubmissionKey(crypto.randomUUID())
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
    if (savingRef.current) return
    if (!expenseSubmissionKey) {
      setFormError('Expense session expired. Close and reopen Record Expense.')
      return
    }
    setFormError('')

    if (!canRecordExpenses) {
      setFormError('You do not have permission to record expenses.')
      return
    }

    if (!currentUser?.id) {
      setFormError('Your user profile could not be verified. Please sign in again.')
      return
    }

    let amount
    try {
      amount = parseExpenseAmount(form.amount)
    } catch (error) {
      setFormError(error.message)
      return
    }
    if (!form.description.trim()) {
      setFormError('Please enter a description.')
      return
    }
    if (!isValidExpenseDate(form.expense_date)) {
      setFormError('Select a valid expense date.')
      return
    }
    if (!CATEGORIES.includes(form.category)) {
      setFormError('Please select a valid category.')
      return
    }
    const dateControlError = expenseDateControlError(form.expense_date, todayISO(), form.backdate_reason)
    if (dateControlError) {
      setFormError(dateControlError)
      return
    }
    const evidenceError = expenseEvidenceControlError(form.reference_number, form.supporting_note)
    if (evidenceError) {
      setFormError(evidenceError)
      return
    }

    savingRef.current = true
    setSaving(true)
    const payload = {
      expense_date: form.expense_date,
      category: form.category,
      description: form.description.trim(),
      amount,
      reference_number: form.reference_number.trim() || null,
      supporting_note: form.supporting_note.trim() || null,
      backdate_reason: form.expense_date < todayISO() ? form.backdate_reason.trim() : null,
      recorded_by: currentUser.id,
      recorded_by_name: recorderName,
      submission_key: expenseSubmissionKey,
    }

    try {
      const expenseIntent = financialSubmissionIntent('expense', payload)
      requireUnchangedFinancialAttempt(expenseAttemptRef.current, expenseIntent)
      let data = null
      if (expenseAttemptRef.current) {
        const previous = await supabase.from('expenses').select('*')
          .eq('submission_key', expenseSubmissionKey).maybeSingle()
        if (previous.error) throw new Error('Could not verify the earlier expense. Review expense history before retrying.')
        if (previous.data) data = assertFinancialSubmissionMatches(expenseAttemptRef.current, previous.data)
      }
      if (!data) {
        expenseAttemptRef.current = expenseIntent
        try {
          data = await recordExpense(supabase, payload)
        } catch (createError) {
          const previous = await supabase.from('expenses').select('*')
            .eq('submission_key', expenseSubmissionKey).maybeSingle()
          if (previous.error) throw new Error('Expense recovery is unavailable. Check history before retrying.')
          if (!previous.data) throw createError
          data = previous.data
        }
        data = assertFinancialSubmissionMatches(expenseAttemptRef.current, data)
      }
      expenseAttemptRef.current = null
      setExpenseSubmissionKey(null)
      setExpenses((current) => [data, ...current])
      setSelectedMonth(String(data.expense_date).slice(0, 7))
      setShowForm(false)
      notifySuccess(`Expense of ${peso.format(data.amount)} recorded: ${data.description}.`)
    } catch (error) {
      setFormError(`${error?.message || 'Connection failed.'} If the request timed out, refresh the history to verify it before trying again.`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function requestVoid(expense) {
    if (
      !canVoidExpenses ||
      !expense ||
      expense.status === 'Voided'
    ) {
      return
    }

    setVoidReason(''); setVoidError('')
    setPendingVoid(expense)
  }

  async function handleVoid(expense) {
    if (!canVoidExpenses || !expense || isVoidedExpense(expense)) {
      setPendingVoid(null)
      return
    }
    if (voidingRef.current) return
    voidingRef.current = true
    setVoidError('')
    setVoidingId(expense.id)
    try {
      const data = await voidExpense(supabase, expense.id, voidReason)
      setExpenses((current) => current.map((item) => item.id === expense.id ? data : item))
      setPendingVoid(null)
      notifySuccess(`Expense of ${peso.format(expense.amount)} was cancelled: ${expense.description}.`)
    } catch (error) {
      setVoidError(`Could not void expense: ${error?.message || 'Connection failed.'}`)
    } finally {
      voidingRef.current = false
      setVoidingId(null)
    }
  }

  const recordedExpenses = visibleExpenses.filter((expense) => !isVoidedExpense(expense))
  const voidedExpenses = visibleExpenses.filter(isVoidedExpense)

  function renderExpenseTable(records, includeActions = false) {
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
              {includeActions && <th>Actions</th>}
            </tr>
          </thead>

          <tbody>
            {records.map((expense) => (
              <tr
                key={expense.id}
                className={
                  expense.status === 'Voided' ? 'tex-row-voided' : ''
                }
              >
                <td>
                  {expense.expense_date
                    ? organization.formatDate(expense.expense_date)
                    : '—'}
                </td>

                <td>
                  <span className="tex-category-pill">
                    {expense.category}
                  </span>
                </td>

                <td>{expense.description}
                  {expense.status === 'Voided' && <small className="tex-void-details">{expense.void_reason
                    ? `Reason: ${expense.void_reason} · ${expense.voided_by_name} · ${organization.formatDate(expense.voided_at, { withTime: true })}`
                    : 'Legacy cancellation: actor, time and reason were not recorded.'}</small>}
                </td>
                <td>
                  {expense.reference_number || '—'}
                  {!expense.reference_number && expense.supporting_note && (
                    <small className="tex-void-details">No reference: {expense.supporting_note}</small>
                  )}
                </td>
                <td>
                  {expense.recorded_by_name || '—'}
                  {expense.backdate_reason && (
                    <small className="tex-void-details">Past-date explanation: {expense.backdate_reason}</small>
                  )}
                </td>

                <td>
                  <span
                    className={`tex-status-pill ${
                      expense.status === 'Voided'
                        ? 'tex-status-voided'
                        : 'tex-status-completed'
                    }`}
                  >
                    {expense.status}
                  </span>
                </td>

                <td className="tex-amount-col tex-amount">
                  {peso.format(Number(expense.amount) || 0)}
                </td>

                {includeActions && (
                  <td>
                    <button
                      type="button"
                      className="tex-void-btn"
                      onClick={() => requestVoid(expense)}
                      disabled={
                        !canVoidExpenses ||
                        expense.status === 'Voided' ||
                        voidingId === expense.id
                      }
                      title="Void expense"
                      aria-label={`Void expense: ${expense.description}`}
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
        <div className="tex-header-heading">
          <span className="tex-header-icon" aria-hidden="true">
            <ReceiptText size={28} strokeWidth={1.8} />
          </span>
          <div className="tex-header-copy">
            <h1 className="tex-page-title">Expenses</h1>
  
            <p className="tex-page-subtitle">
              {isReadOnly
                ? 'View and track association operating expenses.'
                : 'Record and track association operating expenses.'}
            </p>
          </div>
        </div>

        {canRecordExpenses && (
          <button
            type="button"
            className="tex-add-btn"
            onClick={openForm}
          >
            <Plus size={16} /> Record Expense
          </button>
        )}
      </div>

      {pageError && (
        <div className="tex-error" role="alert">
          <AlertCircle size={14} /> {pageError}
          <button type="button" className="tex-btn tex-btn-secondary" onClick={loadExpenses} disabled={loading}>Retry loading</button>
        </div>
      )}

      <div className="tex-stats-grid">
        <div className="tex-stat-card">
          <span className="tex-stat-icon" aria-hidden="true"><DollarSign size={17} /></span>
          <span className="tex-stat-label">
            Net {monthLabel(selectedMonth)}
          </span>
          <h3 className="tex-stat-value">
            {loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(summary.totalSelectedMonth)}
          </h3>
          <small>Selected month operating expenses</small>
          <div className="tex-stat-footer"><span aria-hidden="true" />Voided expenses excluded</div>
        </div>

        <div className="tex-stat-card">
          <span className="tex-stat-icon" aria-hidden="true"><CheckCircle size={17} /></span>
          <span className="tex-stat-label">All-time net expenses</span>
          <h3 className="tex-stat-value">
            {loading ? <Skeleton variant="rect" width="86px" height="1.2em" /> : pageError ? 'Unavailable' : peso.format(summary.totalAllTime)}
          </h3>
          <small>All recorded expenses</small>
          <div className="tex-stat-footer"><span aria-hidden="true" />Voided expenses excluded</div>
        </div>

        <div className="tex-stat-card">
          <span className="tex-stat-icon" aria-hidden="true"><FileText size={17} /></span>
          <span className="tex-stat-label">
            {monthLabel(selectedMonth)} Entries
          </span>
          <h3 className="tex-stat-value">
            {loading ? <Skeleton variant="rect" width="42px" height="1.2em" /> : pageError ? 'Unavailable' : summary.count}
          </h3>
          <small>Entries in the selected month</small>
          <div className="tex-stat-footer"><span aria-hidden="true" />Selected-month records</div>
        </div>

        <div className="tex-stat-card">
          <span className="tex-stat-icon" aria-hidden="true"><AlertCircle size={17} /></span>
          <span className="tex-stat-label">Top Category</span>
          <h3 className="tex-stat-value tex-stat-value-sm">
            {loading || !summary.topCategory
              ? '—'
              : summary.topCategory.name}
          </h3>
          <small>Highest selected-month category</small>
          <div className="tex-stat-footer"><span aria-hidden="true" />Based on selected-month expenses</div>
        </div>
      </div>

      <div className="tex-table-panel">
        <div className="tex-history-header">
          <div>
            <h3 className="tex-section-title">Expense History</h3>
            <p className="tex-history-caption">
              Select a month to view its archived expense records.
            </p>
          </div>

          <div className="tex-month-picker" ref={monthPickerRef}>
            <button
              type="button"
              className="tex-month-nav"
              onClick={() =>
                setSelectedMonth((month) => shiftMonth(month, -1))
              }
              aria-label="View previous month"
            >
              ‹
            </button>

            <button
              type="button"
              className={`tex-month-trigger ${
                monthPickerOpen ? 'is-open' : ''
              }`}
              onClick={() =>
                monthPickerOpen
                  ? closeMonthPicker()
                  : openMonthPicker()
              }
              aria-expanded={monthPickerOpen}
              aria-haspopup="dialog"
            >
              <span className="tex-month-trigger-icon" aria-hidden="true">
                ▣
              </span>

              <span>
                {MONTHS[selectedMonthIndex]} {selectedYear}
              </span>

              <span
                className="tex-month-trigger-chevron"
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              className="tex-month-nav"
              onClick={() =>
                setSelectedMonth((month) => shiftMonth(month, 1))
              }
              aria-label="View next month"
            >
              ›
            </button>

            {monthMenuMounted && createPortal(
              <div
                className={`tex-month-menu ${
                  monthMenuVisible ? 'is-visible' : ''
                }`}
                role="dialog"
                aria-label="Select expense history month"
                style={monthMenuPosition || undefined}
              >
                <div className="tex-month-menu-header">
                  <button
                    type="button"
                    className="tex-year-nav"
                    onClick={() =>
                      setSelectedMonth(
                        `${selectedYear - 1}-${String(
                          selectedMonthIndex + 1,
                        ).padStart(2, '0')}`,
                      )
                    }
                    aria-label="Previous year"
                  >
                    ‹
                  </button>

                  <strong>{selectedYear}</strong>

                  <button
                    type="button"
                    className="tex-year-nav"
                    onClick={() =>
                      setSelectedMonth(
                        `${selectedYear + 1}-${String(
                          selectedMonthIndex + 1,
                        ).padStart(2, '0')}`,
                      )
                    }
                    aria-label="Next year"
                  >
                    ›
                  </button>
                </div>

                <div className="tex-month-grid">
                  {MONTHS.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      className={
                        index === selectedMonthIndex ? 'is-selected' : ''
                      }
                      onClick={() => selectMonth(selectedYear, index)}
                    >
                      {name.slice(0, 3)}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="tex-current-month"
                  onClick={() => {
                    const currentMonth = manilaMonthKey()
                    const [year, month] = currentMonth
                      .split('-')
                      .map(Number)

                    selectMonth(year, month - 1)
                  }}
                >
                  Jump to current month
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>

        {loading ? (
          <div className="tex-state" aria-busy="true"><Skeleton variant="rect" width="100%" height="56px" /><Skeleton variant="rect" width="100%" height="56px" /><Skeleton variant="rect" width="100%" height="56px" /><Skeleton variant="rect" width="100%" height="56px" /><span className="skeleton-region-status" role="status">Loading</span></div>
        ) : pageError ? (
          <div className="tex-state" role="status">Expense history is temporarily unavailable. Retry loading to verify these records.</div>
        ) : visibleExpenses.length === 0 ? (
          <div className="tex-state">
            {expenses.length === 0
              ? canRecordExpenses
                ? 'No expenses recorded yet. Click "Record Expense" to add one.'
                : 'No expenses have been recorded yet.'
              : `No expenses were recorded in ${monthLabel(
                  selectedMonth,
                )}. Choose another month to view archived history.`}
          </div>
        ) : (
          <>
            {recordedExpenses.length > 0 && (
              <>
                <h4 className="tex-history-subtitle">
                  Recorded Expenses
                </h4>

                {renderExpenseTable(
                  recordedExpenses,
                  canVoidExpenses,
                )}
              </>
            )}

            {voidedExpenses.length > 0 && (
              <>
                <h4 className="tex-history-subtitle tex-history-subtitle-voided">
                  Voided Expenses
                </h4>

                <p className="tex-history-note">
                  Voided expenses are kept for audit history and excluded
                  from totals.
                </p>

                {renderExpenseTable(voidedExpenses, false)}
              </>
            )}
          </>
        )}
      </div>

      {showForm && canRecordExpenses && (
        <div className="tex-modal-overlay" onClick={closeForm}>
          <div
            className="tex-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="tex-modal-close"
              onClick={closeForm}
              disabled={saving}
              aria-label="Close expense form"
            >
              <X size={20} />
            </button>

            <div className="tex-modal-header">
              <DollarSign size={18} />
              <h2>Record Expense</h2>
            </div>

            <form onSubmit={handleSubmit} className="tex-form" inert={saving ? "inert" : undefined} aria-busy={saving}>
              <div className="tex-form-row">
                <div className="tex-field">
                  <span className="tex-field-label">Date</span>
                  <DateField
                    value={form.expense_date}
                    onChange={(key) =>
                      updateForm('expense_date', key)
                    }
                    max={todayISO()}
                    placeholder="Select date"
                    ariaLabel="Expense date"
                  />
                  {form.expense_date && form.expense_date < todayISO() && (
                    <label>
                      Reason for recording an earlier expense date (required)
                      <textarea
                        rows={2}
                        maxLength={500}
                        minLength={10}
                        value={form.backdate_reason}
                        onChange={(event) => updateForm('backdate_reason', event.target.value)}
                        placeholder="Explain why this past expense is being recorded now..."
                        required
                      />
                    </label>
                  )}
                </div>

                <div className="tex-field">
                  <span className="tex-field-label">Category</span>
                  <Select
                    value={form.category}
                    options={CATEGORY_OPTIONS}
                    onChange={(value) =>
                      updateForm('category', value)
                    }
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
                  onChange={(event) =>
                    updateForm('description', event.target.value)
                  }
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
                    onChange={(event) =>
                      updateForm('amount', event.target.value)
                    }
                    required
                  />
                </label>

                <label>
                  Reference No. (optional)
                  <input
                    type="text"
                    placeholder="OR / invoice number"
                    value={form.reference_number}
                    onChange={(event) =>
                      updateForm(
                        'reference_number',
                        event.target.value,
                      )
                    }
                  />
                </label>
              </div>

              {!form.reference_number.trim() && (
                <label>
                  Why is there no receipt / invoice reference? (required)
                  <textarea
                    rows={3}
                    maxLength={500}
                    minLength={10}
                    value={form.supporting_note}
                    onChange={(event) => updateForm('supporting_note', event.target.value)}
                    placeholder="Explain the missing supporting reference and where evidence can be found..."
                    required
                  />
                </label>
              )}
              <p className="tex-history-note">Enter an invoice or receipt number when available. If no reference exists, your explanation is saved with this expense.</p>

              {formError && (
                <p className="tex-form-error">{formError}</p>
              )}

              <div className="tex-form-footer">
                <button
                  type="button"
                  className="tex-btn tex-btn-secondary button-cancel"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="tex-btn tex-btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ExpenseVoidDialog
        expense={canVoidExpenses ? pendingVoid : null}
        reason={voidReason}
        onReason={setVoidReason}
        error={voidError}
        busy={Boolean(voidingId)}
        onConfirm={() => { if (pendingVoid) handleVoid(pendingVoid) }}
        onCancel={() => { if (!voidingId) { setPendingVoid(null); setVoidError('') } }}
      />
    </div>
  )
}