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

  const recorded = EXPENSE_BUDGET_CATEGORIES.filter(category => values[category] !== undefined && values[category] !== '' && isBudgetAmount(values[category]))
  const total = recorded.reduce((sum, category) => sum + Number(values[category]), 0)
  const hasDraft = hasInvalid || EXPENSE_BUDGET_CATEGORIES.some(category => String(values[category] ?? '') !== String(saved[category] ?? '')) || reason !== ''

  function discardBudget() {
    if (busy) return
    setValues({ ...saved })
    setReason('')
    setError('')
  }

  return <section className="expense-budget-card eb-workspace">
    <header className="eb-page-head">
      <div><h2>Expense Budgets</h2><p>Plan annual expense allocations and review approvals by category.</p></div>
      <label className="eb-year">Budget year
        <input type="number" min="2000" max="2100" step="1" value={year} disabled={busy || loading}
          onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 2000 && n <= 2100) setYear(n) }} />
      </label>
    </header>
    {error && <p className="ss-message error" role="alert">{error}</p>}
    <div className="eb-summary-grid" aria-label="Budget summary">
      <BudgetMetric label="Annual allocation" value={loading ? '—' : display(total)} note="Entered amounts across all categories" icon="peso" />
      <BudgetMetric label="Monthly reference" value={loading ? '—' : `≈ ${display(total / 12)}`} note="Approximate annual total ÷ 12" icon="calendar" />
      <BudgetMetric label="Allocation coverage" value={loading ? '—' : `${recorded.length} / ${EXPENSE_BUDGET_CATEGORIES.length}`} note={`${recorded.length} of ${EXPENSE_BUDGET_CATEGORIES.length} categories recorded`} icon="check" />
    </div>
    {loading ? <p className="ss-info" role="status">Loading approved annual allocations…</p> : <form onSubmit={submit} className="eb-form eb-layout">
      <div className="eb-allocation-card">
        <header className="eb-allocation-head"><div><h3>Category allocations</h3><p>Edit the annual amount. Monthly references update automatically.</p></div><span>Amounts in PHP</span></header>
        <div className="eb-table-wrap"><table className="eb-table"><thead><tr>
          <th scope="col">Expense category</th><th scope="col">Annual budget</th><th scope="col">Monthly reference</th><th scope="col">Status</th>
        </tr></thead><tbody>{EXPENSE_BUDGET_CATEGORIES.map(category => {
          const value = values[category]
          const missing = value === undefined || value === ''
          const invalid = !missing && !isBudgetAmount(value)
          const modified = changes.includes(category)
          const status = missing ? 'Not recorded' : invalid ? 'Invalid' : modified ? 'Modified' : 'Recorded'
          return <tr key={category} className={modified ? 'eb-is-modified' : ''}>
            <th scope="row">{category}</th>
            <td data-label="Annual budget"><div className="eb-input-wrap"><span aria-hidden="true">₱</span><input aria-label={`${category} annual budget`} type="number" min="0" max="999999999999.99" step="0.01"
              disabled={!canEdit || busy} placeholder="Not recorded" value={value ?? ''} aria-invalid={invalid}
              onChange={e => setValues(prev => ({ ...prev, [category]: e.target.value }))}/></div></td>
            <td data-label="Monthly reference">{missing || invalid ? 'Not recorded' : `≈ ${display(Number(value) / 12)}`}</td>
            <td data-label="Status"><span className={`eb-allocation-status ${missing ? '' : invalid ? 'invalid' : modified ? 'modified' : 'recorded'}`}>{status}</span></td>
          </tr>
        })}</tbody></table></div>
        <details className="eb-guidance"><summary>How budget amounts are used</summary><p>Blank means no approved allocation. Enter 0 to approve a zero budget. Budgets do not change expense transactions. Monthly reports compare spending against these annual allocations; centavos are distributed across the twelve months so yearly totals match exactly. Saved allocations cannot be deleted here; update their approved amount instead.</p></details>
      </div>
      <aside className="eb-approval-card" aria-labelledby="eb-approval-title">
        <div className="eb-approval-heading"><span aria-hidden="true">2</span><div><h3 id="eb-approval-title">Review &amp; approve</h3><p>Complete after editing allocations.</p></div></div>
        <div className={`eb-change-state ${changes.length ? 'has-changes' : ''}`} role="status"><i aria-hidden="true" />{changes.length} changed allocation{changes.length === 1 ? '' : 's'} ready to save</div>
        <label className="eb-reason">Approval or amendment reason
          <textarea rows={4} maxLength={1000} value={reason} disabled={!canEdit || busy}
            onChange={e => setReason(e.target.value)} placeholder="Record the board approval or explain the amendment." />
          <small>Required for audit · 5–1000 characters</small>
        </label>
        {canEdit && <div className="eb-actions">
          <button type="submit" className="ss-primary" disabled={busy || hasInvalid || !changes.length || reason.trim().length < 5 || reason.trim().length > 1000}>{busy ? 'Saving…' : 'Approve and save budget'}</button>
          <button type="button" className="ss-secondary" onClick={discardBudget} disabled={busy || !hasDraft}>Discard budget changes</button>
        </div>}
        <p className="eb-own-save">Budgets save separately from General and Security preferences.</p>
      </aside>
    </form>}
  </section>
}

function BudgetMetric({ label, value, note, icon }) {
  return <article className="eb-metric"><div><span>{label}</span><i aria-hidden="true">{icon === 'peso' ? '₱' : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{icon === 'calendar' ? <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></> : <><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/></>}</svg>}</i></div><strong>{value}</strong><small>{note}</small></article>
}
