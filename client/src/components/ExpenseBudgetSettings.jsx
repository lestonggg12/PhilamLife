import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { notifySuccess } from '../lib/actionFeedback'
import { EXPENSE_BUDGET_CATEGORIES, isBudgetAmount } from '../lib/expenseBudget'
import './ExpenseBudgetSettings.css'

const yearToday = () => Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date()))
const display = value => Number(value).toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })

export default function ExpenseBudgetSettings({ canEdit = false }) {
  const [year, setYear] = useState(yearToday)
  const [values, setValues] = useState({})
  const [saved, setSaved] = useState({})
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changes = useMemo(() => EXPENSE_BUDGET_CATEGORIES.filter(category =>
    values[category] !== '' && values[category] !== undefined &&
    isBudgetAmount(values[category]) &&
    (saved[category] === undefined || Number(values[category]) !== Number(saved[category]))), [values, saved])
  const hasInvalid = EXPENSE_BUDGET_CATEGORIES.some(category =>
    values[category] !== '' && values[category] !== undefined && !isBudgetAmount(values[category]))

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setValues({})
    setSaved({})
    setReason('')
    supabase.from('expense_budgets')
      .select('budget_year,category,approved_annual_amount')
      .eq('budget_year', year)
      .order('category')
      .then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) { setError(`Cannot load approved expense budgets: ${loadError.message}`); return }
        const next = Object.fromEntries((data || []).map(row => [row.category, String(row.approved_annual_amount)]))
        setValues(next)
        setSaved(next)
      }).catch(e => { if (active) setError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [year])

  async function submit(event) {
    event.preventDefault()
    if (!canEdit || busy || loading || hasInvalid || !changes.length || reason.trim().length < 5 || reason.trim().length > 1000) return
    setBusy(true)
    setError('')
    try {
      const entries = changes.map(category => ({ category, amount: String(values[category]) }))
      const { error: saveError } = await supabase.rpc('save_annual_expense_budgets', {
        p_year: year, p_entries: entries, p_reason: reason.trim(),
      })
      if (saveError) throw saveError
      const { data, error: refreshError } = await supabase.from('expense_budgets')
        .select('category,approved_annual_amount').eq('budget_year', year)
      if (refreshError) throw refreshError
      const next = Object.fromEntries((data || []).map(row => [row.category, String(row.approved_annual_amount)]))
      setSaved(next); setValues(next); setReason('')
      notifySuccess(`${year} expense budget saved and audited.`)
    } catch (e) { setError(e.message || 'Budget save failed. Reload and try again.') }
    finally { setBusy(false) }
  }

  return <div className="ss-card expense-budget-card full">
    <div className="ss-card-heading"><h2>Expense Budgets</h2>
      <p>Admin-approved annual allocations by the same categories used in Expenses. Treasurer monthly reports compare actual spending with one-twelfth of these annual allocations.</p>
    </div>
    <form onSubmit={submit} className="eb-form">
      <label className="ss-field eb-year">Budget calendar year
        <input type="number" min="2000" max="2100" step="1" value={year} disabled={busy || loading}
          onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 2000 && n <= 2100) setYear(n) }} />
      </label>
      {error && <p className="ss-message error" role="alert">{error}</p>}
      {loading ? <p className="ss-info">Loading approved annual allocations…</p> : <>
        <div className="eb-table-wrap"><table className="eb-table"><thead><tr>
          <th>Expense category</th><th>Approved annual budget (PHP)</th><th>Monthly reference (annual ÷ 12)</th>
        </tr></thead><tbody>{EXPENSE_BUDGET_CATEGORIES.map(category => <tr key={category}>
          <th scope="row">{category}</th>
          <td><input aria-label={`${category} annual budget`} type="number" min="0" max="999999999999.99" step="0.01"
            disabled={!canEdit || busy} placeholder="Not recorded" value={values[category] ?? ''}
            onChange={e => setValues(prev => ({ ...prev, [category]: e.target.value }))}/></td>
          <td>{values[category] === undefined || values[category] === '' || !isBudgetAmount(values[category])
            ? 'Not recorded' : `≈ ${display(Number(values[category]) / 12)}`}</td>
        </tr>)}</tbody></table></div>
        <p className="ss-info">Blank means no approved allocation. Enter 0 to approve a zero budget. Annual budgets are stored without changing expense transactions. Reports allocate centavos across the twelve months so yearly totals match exactly. Saved allocations cannot be deleted here; update their approved amount instead.</p>
        <label className="ss-field eb-reason">Approval or amendment reason (required for audit trail)
          <textarea rows={2} maxLength={1000} value={reason} disabled={!canEdit || busy}
            onChange={e => setReason(e.target.value)} placeholder="Example: Board-approved operating budget for this year" />
        </label>
        <div className="eb-actions"><span>{changes.length} changed allocation{changes.length === 1 ? '' : 's'} ready to save</span>
          {canEdit && <button type="submit" className="ss-primary" disabled={busy || hasInvalid || !changes.length || reason.trim().length < 5 || reason.trim().length > 1000}>
            {busy ? 'Saving…' : 'Approve and save budget'}
          </button>}
        </div>
      </>}
    </form>
  </div>
}
