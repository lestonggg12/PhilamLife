
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  fractionToPercent,
  parseWholeNumber,
  percentToFraction,
} from '../lib/latepenalty'
import './LatePenaltySettings.css'

export default function LatePenaltySettings({ canEdit = false }) {
  const [defaultRate, setDefaultRate] = useState('')
  const [firstAfter, setFirstAfter] = useState('12')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('system_settings')
        .select('late_penalty_rate, late_penalty_first_after_months')
        .eq('id', 1)
        .maybeSingle()

      if (error) {
        setMessage({
          type: 'error',
          text: `Unable to load penalty settings: ${error.message}`,
        })
      } else {
        setDefaultRate(fractionToPercent(data?.late_penalty_rate))
        setFirstAfter(
          String(data?.late_penalty_first_after_months ?? 12)
        )
      }

      setLoading(false)
    }

    load()
  }, [])

  function fail(text) {
    setMessage({ type: 'error', text })
  }

  async function saveDefaults(event) {
    event.preventDefault()

    if (!canEdit) {
      return fail('Only an Admin can change the penalty settings.')
    }

    const rate = percentToFraction(
      defaultRate,
      'Default yearly penalty rate'
    )
    if (rate.error) return fail(rate.error)

    const months = parseWholeNumber(
      firstAfter,
      'Months before the first penalty',
      1,
      600
    )
    if (months.error) return fail(months.error)

    setBusy(true)
    setMessage(null)

    const { data, error } = await supabase
      .from('system_settings')
      .update({
        late_penalty_rate: rate.value,
        late_penalty_first_after_months: months.value,
      })
      .eq('id', 1)
      .select('late_penalty_rate')

    setBusy(false)

    if (error) return fail(error.message)

    if (!data?.length) {
      return fail('Only an Admin can change the penalty settings.')
    }

    setMessage({
      type: 'success',
      text: 'Penalty settings saved.',
    })
  }

  if (loading) {
    return <p className="ss-info">Loading penalty settings…</p>
  }

  return (
    <div className="lps">
      <p className="ss-info">
        The system uses the default annual rate for system-generated
        penalties. Previously recorded balances and penalties should
        be based on verified HOA records.
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
            onChange={(event) => {
              setDefaultRate(event.target.value)
              setMessage(null)
            }}
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
            onChange={(event) => {
              setFirstAfter(event.target.value)
              setMessage(null)
            }}
            disabled={!canEdit || busy}
            placeholder="12"
          />
        </label>

        {canEdit && (
          <button
            type="submit"
            className="ss-primary"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save penalty settings'}
          </button>
        )}
      </form>

      {!canEdit && (
        <p className="ss-info">
          Only an Admin can change these settings.
        </p>
      )}

      {message && (
        <div
          className={`ss-message ${message.type}`}
          role="status"
        >
          {message.text}
        </div>
      )}
    </div>
  )
}
