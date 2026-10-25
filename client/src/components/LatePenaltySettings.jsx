import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  formatPercent,
  fractionToPercent,
  parseWholeNumber,
  percentToFraction,
} from '../lib/latepenalty'
import './LatePenaltySettings.css'

// Admin card: the default yearly late-payment penalty, how many months before the
// first penalty, and an optional rate for any specific year. Only an Admin can save.
export default function LatePenaltySettings({ canEdit = false }) {
  const [defaultRate, setDefaultRate] = useState('')
  const [firstAfter, setFirstAfter] = useState('')
  const [yearRates, setYearRates] = useState([])
  const [newYear, setNewYear] = useState('')
  const [newRate, setNewRate] = useState('')
  const [editingYear, setEditingYear] = useState(null)
  const [editingRate, setEditingRate] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  async function load() {
    const [settingsResult, ratesResult] = await Promise.all([
      supabase
        .from('system_settings')
        .select('late_penalty_rate, late_penalty_first_after_months')
        .eq('id', 1)
        .maybeSingle(),
      supabase.from('late_penalty_year_rates').select('year, rate').order('year'),
    ])
    const error = settingsResult.error || ratesResult.error
    if (error) {
      setMessage({ type: 'error', text: `Unable to load the penalty settings: ${error.message}` })
    } else {
      setDefaultRate(fractionToPercent(settingsResult.data?.late_penalty_rate))
      setFirstAfter(String(settingsResult.data?.late_penalty_first_after_months ?? 12))
      setYearRates(ratesResult.data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function fail(text) {
    setMessage({ type: 'error', text })
  }

  async function saveDefaults(event) {
    event.preventDefault()
    if (!canEdit) return fail('Only an Admin can change the penalty settings.')

    const rate = percentToFraction(defaultRate, 'Default yearly penalty rate')
    if (rate.error) return fail(rate.error)
    const months = parseWholeNumber(firstAfter, 'Months before the first penalty', 1, 600)
    if (months.error) return fail(months.error)

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('system_settings')
      .update({ late_penalty_rate: rate.value, late_penalty_first_after_months: months.value })
      .eq('id', 1)
      .select('late_penalty_rate')
    setBusy(false)
    if (error) return fail(error.message)
    if (!data?.length) return fail('Only an Admin can change the penalty settings.')
    setMessage({ type: 'success', text: 'Penalty settings saved. They apply to penalties posted from now on.' })
  }

  async function saveYearRate(yearValue, rateText, afterSave) {
    if (!canEdit) return fail('Only an Admin can change the penalty settings.')
    const year = parseWholeNumber(yearValue, 'Year', 2000, 2100)
    if (year.error) return fail(year.error)
    const rate = percentToFraction(rateText, 'Rate for that year')
    if (rate.error) return fail(rate.error)

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('late_penalty_year_rates')
      .upsert({ year: year.value, rate: rate.value }, { onConflict: 'year' })
      .select('year')
    setBusy(false)
    if (error) return fail(error.message)
    if (!data?.length) return fail('Only an Admin can change the penalty settings.')
    afterSave()
    setMessage({ type: 'success', text: `Rate for ${year.value} saved.` })
    load()
  }

  async function removeYearRate(year) {
    if (!canEdit) return fail('Only an Admin can change the penalty settings.')
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase
      .from('late_penalty_year_rates')
      .delete()
      .eq('year', year)
      .select('year')
    setBusy(false)
    if (error) return fail(error.message)
    if (!data?.length) return fail('Only an Admin can change the penalty settings.')
    setMessage({ type: 'success', text: `Rate for ${year} removed. That year now uses the default rate.` })
    load()
  }

  if (loading) return <p className="ss-info">Loading penalty settings…</p>

  return (
    <div className="lps">
      <p className="ss-info">
        A balance that stays unpaid is charged one penalty for every full year since its “as of” date,
        on the unpaid part of the balance. Earlier penalties are never added to the base.
      </p>

      <form className="lps-defaults" onSubmit={saveDefaults}>
        <label className="ss-field">
          <span>Default yearly penalty (%)</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.01"
            value={defaultRate}
            onChange={(event) => { setDefaultRate(event.target.value); setMessage(null) }}
            disabled={!canEdit || busy}
            placeholder="e.g., 1.5"
          />
        </label>
        <label className="ss-field">
          <span>Months before the first penalty</span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="600"
            step="1"
            value={firstAfter}
            onChange={(event) => { setFirstAfter(event.target.value); setMessage(null) }}
            disabled={!canEdit || busy}
            placeholder="12"
          />
        </label>
        {canEdit && (
          <button type="submit" className="ss-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save penalty settings'}
          </button>
        )}
      </form>

      <h4 className="lps-heading">Rate for a specific year</h4>
      <p className="ss-info">
        A year listed here replaces the default for penalties that fall due in that year.
        Use 0% to waive a year.
      </p>

      {yearRates.length === 0 ? (
        <p className="lps-empty">No year-specific rates. Every year uses the default.</p>
      ) : (
        <table className="lps-table">
          <thead>
            <tr><th>Year</th><th>Penalty</th><th aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {yearRates.map((row) => (
              <tr key={row.year}>
                <td><strong>{row.year}</strong></td>
                <td>
                  {editingYear === row.year ? (
                    <input
                      className="lps-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={editingRate}
                      onChange={(event) => setEditingRate(event.target.value)}
                      disabled={busy}
                      autoFocus
                    />
                  ) : (
                    formatPercent(row.rate)
                  )}
                </td>
                <td className="lps-actions">
                  {canEdit && editingYear === row.year && (
                    <>
                      <button
                        type="button"
                        className="lps-link"
                        disabled={busy}
                        onClick={() => saveYearRate(row.year, editingRate, () => setEditingYear(null))}
                      >
                        Save
                      </button>
                      <button type="button" className="lps-link" onClick={() => setEditingYear(null)}>Cancel</button>
                    </>
                  )}
                  {canEdit && editingYear !== row.year && (
                    <>
                      <button
                        type="button"
                        className="lps-link"
                        disabled={busy}
                        onClick={() => { setEditingYear(row.year); setEditingRate(fractionToPercent(row.rate)); setMessage(null) }}
                      >
                        Edit
                      </button>
                      <button type="button" className="lps-link lps-danger" disabled={busy} onClick={() => removeYearRate(row.year)}>
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <div className="lps-add">
          <label className="ss-field">
            <span>Year</span>
            <input
              type="number"
              inputMode="numeric"
              min="2000"
              max="2100"
              step="1"
              value={newYear}
              onChange={(event) => { setNewYear(event.target.value); setMessage(null) }}
              disabled={busy}
              placeholder="e.g., 2026"
            />
          </label>
          <label className="ss-field">
            <span>Penalty (%)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="0.01"
              value={newRate}
              onChange={(event) => { setNewRate(event.target.value); setMessage(null) }}
              disabled={busy}
              placeholder="e.g., 2"
            />
          </label>
          <button
            type="button"
            className="ss-primary"
            disabled={busy}
            onClick={() => saveYearRate(newYear, newRate, () => { setNewYear(''); setNewRate('') })}
          >
            Set rate for year
          </button>
        </div>
      )}

      {!canEdit && <p className="ss-info">Only an Admin can change these settings.</p>}
      {message && <div className={`ss-message ${message.type}`} role="status">{message.text}</div>}
    </div>
  )
}