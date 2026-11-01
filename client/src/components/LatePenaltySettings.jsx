import { notifySuccess } from '../lib/actionFeedback'

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
  const [effectiveDate, setEffectiveDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessageState] = useState(null)
  function setMessage(next) {
    setMessageState(next)
    if (next?.type === 'success') notifySuccess(next.text)
  }

  useEffect(() => {
    async function load() {
      try {
        const [policy, settings] = await Promise.all([
          supabase.from('annual_penalty_policy').select('effective_date').eq('id', 1).single(),
          supabase.from('system_settings').select('late_penalty_rate, late_penalty_first_after_months').eq('id', 1).single(),
        ])
        if (policy.error || settings.error) throw policy.error || settings.error
        setEffectiveDate(policy.data.effective_date)
        setDefaultRate(fractionToPercent(settings.data.late_penalty_rate))
        setFirstAfter(String(settings.data.late_penalty_first_after_months ?? 12))
      } catch (error) {
        setMessage({ type: 'error', text: `Unable to load penalty settings: ${error.message}` })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function fail(text) {
    setMessage({ type: 'error', text })
  }

  async function saveDefaults(event) {
    event.preventDefault()

    if (!effectiveDate) return fail('Install the annual penalty policy before changing these settings.')

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

    try {
      const { data, error } = await supabase
        .from('system_settings')
        .update({ late_penalty_rate: rate.value, late_penalty_first_after_months: months.value })
        .eq('id', 1)
        .select('late_penalty_rate')
      if (error) throw error
      if (!data?.length) return fail('Only an Admin can change the penalty settings.')
      setMessage({
        type: 'success',
        text: 'Penalty settings saved. New rates apply to later assessments; existing schedules and posted penalties are unchanged.',
      })
    } catch (error) {
      fail(error.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="ss-info">Loading penalty settings…</p>
  }

  return (
    <div className="lps">
      <p className="ss-info">
        Annual penalties compound on unpaid Association Dues, recorded balances
        and unpaid penalties. Payments and credits reduce the next assessment base.
        Historical balances and assessments are not recalculated.
        {effectiveDate && ` Automatic posting starts ${effectiveDate} (Manila time).`}
      </p>
      <p className="ss-info">
        First assessment: As-of Date + configured months. Later assessments: every 12 months.
        Pre-activation dates are skipped. Months changes affect new schedules only.
        Current rate is saved per assessment.
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
            disabled={!canEdit || busy || !effectiveDate}
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
            disabled={!canEdit || busy || !effectiveDate}
            placeholder="12"
          />
        </label>

        {canEdit && (
          <button
            type="submit"
            className="ss-primary"
            disabled={busy || !effectiveDate}
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
