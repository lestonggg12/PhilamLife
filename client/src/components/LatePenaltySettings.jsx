import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { manilaToday } from '../lib/propertyClassification'
import { notifySuccess } from '../lib/actionFeedback'
import DateField from './DateField'
import Skeleton from './skeleton/Skeleton'
import './LatePenaltySettings.css'

const percent = (rate) =>
  (Number(rate) * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')

const shiftToday = (years, days) => {
  const date = new Date(`${manilaToday()}T00:00:00Z`)
  date.setUTCFullYear(date.getUTCFullYear() + years)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export default function LatePenaltySettings({ canEdit = false }) {
  const [rules, setRules] = useState([])
  const [draft, setDraft] = useState({ lot_owner: '', homeowner: '' })
  const [effectiveFrom, setEffectiveFrom] = useState(() => shiftToday(0, 1))
  const [reason, setReason] = useState('')
  const [months, setMonths] = useState('12')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const latest = (kind) => rules.find((r) => r.property_classification === kind)
  const current = (kind) => rules.find(
    (r) => r.property_classification === kind && r.effective_from <= manilaToday()
  )

  async function load() {
    setLoading(true)
    try {
      const [rates, settings] = await Promise.all([
        supabase.from('annual_penalty_rate_rules')
          .select('id,property_classification,effective_from,annual_rate,rule_note')
          .order('effective_from', { ascending: false }),
        supabase.from('system_settings')
          .select('late_penalty_first_after_months').eq('id', 1).single(),
      ])
      if (rates.error || settings.error) throw rates.error || settings.error
      const rows = rates.data || []
      const newest = (kind) => rows.find((r) => r.property_classification === kind)
      if (!newest('lot_owner') || !newest('homeowner')) {
        throw new Error('Classification-specific penalty rules are missing.')
      }
      setRules(rows)
      setDraft({
        lot_owner: percent(newest('lot_owner').annual_rate),
        homeowner: percent(newest('homeowner').annual_rate),
      })
      setMonths(String(settings.data.late_penalty_first_after_months ?? 12))
      setEffectiveFrom(shiftToday(0, 1))
      setReason('')
      setMessage(null)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const rateValid = (value) =>
    /^\d+(\.\d{1,4})?$/.test(String(value)) &&
    Number(value) >= 0 && Number(value) <= 100

  const changed = Boolean(
    latest('lot_owner') && latest('homeowner') &&
    (Number(draft.lot_owner) !== Number(percent(latest('lot_owner').annual_rate)) ||
     Number(draft.homeowner) !== Number(percent(latest('homeowner').annual_rate)))
  )

  async function saveRates(event) {
    event.preventDefault()
    if (!canEdit || busy) return
    if (!rateValid(draft.lot_owner) || !rateValid(draft.homeowner)) {
      setMessage({ type: 'error', text: 'Enter valid percentages from 0 to 100 (up to four decimals).' })
      return
    }
    if (!changed || effectiveFrom <= manilaToday() || reason.trim().length < 5 ||
        reason.trim().length > 1000) {
      setMessage({ type: 'error', text: 'Change at least one rate, choose a future Manila date and enter a reason (5–1000 characters).' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('set_annual_penalty_rates', {
        p_lot_owner_rate: Number((Number(draft.lot_owner) / 100).toFixed(6)),
        p_homeowner_rate: Number((Number(draft.homeowner) / 100).toFixed(6)),
        p_effective_from: effectiveFrom,
        p_reason: reason.trim(),
        p_expected_lot_rule_id: latest('lot_owner').id,
        p_expected_home_rule_id: latest('homeowner').id,
      })
      if (error) throw error
      notifySuccess('New annual penalty rates scheduled and audited.')
      await load()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function saveMonths(event) {
    event.preventDefault()
    if (!canEdit || busy) return
    const value = Number(months)
    if (!Number.isInteger(value) || value < 1 || value > 600) {
      setMessage({ type: 'error', text: 'Enter between 1 and 600 months.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const { data, error } = await supabase.from('system_settings')
        .update({ late_penalty_first_after_months: value })
        .eq('id', 1).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Only Admin can update penalty settings.')
      notifySuccess('First-penalty timing saved for new schedules.')
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return (
    <div className="lps" aria-busy="true">
      <Skeleton variant="text" lines={3} />
      <Skeleton width="100%" height="95px" radius="12px" />
      <span role="status">Loading penalty rules...</span>
    </div>
  )

  return (
    <div className="lps lps-phase2">
      <p className="ss-info lps-wide">
        Annual penalties compound on unpaid balances. Unclassified properties
        are excluded. Historical posted penalties are not recalculated.
      </p>

      <div className="lps-rate-grid">
        {[
          ['lot_owner', 'Lot Owner'],
          ['homeowner', 'Homeowner'],
        ].map(([kind, title]) => (
          <article className="lps-rate-card" key={kind}>
            <span>{title}</span>
            <strong>{current(kind) ? percent(current(kind).annual_rate) + '%' : 'Not active'}</strong>
            <small>Current annual compound rate</small>
            {latest(kind)?.effective_from > manilaToday() && (
              <small>Scheduled: {percent(latest(kind).annual_rate)}% from {latest(kind).effective_from}</small>
            )}
          </article>
        ))}
      </div>

      <form className="lps-rate-form" onSubmit={saveRates}>
        <h3>Schedule new annual rates</h3>
        <div className="lps-rate-fields">
          {[
            ['lot_owner', 'Lot Owner (%)'],
            ['homeowner', 'Homeowner (%)'],
          ].map(([kind, title]) => (
            <label className="ss-field" key={kind}>
              <span>{title}</span>
              <input type="number" min="0" max="100" step="any"
                value={draft[kind]} disabled={!canEdit || busy}
                onChange={(e) => setDraft((old) => ({ ...old, [kind]: e.target.value }))} />
            </label>
          ))}
        </div>
        <label className="ss-field">
          <span>Effective date (future Manila date)</span>
          <DateField value={effectiveFrom} onChange={setEffectiveFrom}
            min={shiftToday(0, 1)} max={shiftToday(0, 3650)}
            clearable={false} disabled={!canEdit || busy}
            ariaLabel="Rate effective date" />
        </label>
        <label className="ss-field">
          <span>Reason for rate change</span>
          <textarea value={reason} maxLength={1000} rows={2}
            disabled={!canEdit || busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Record the approval or reason..." />
          <small>{reason.length}/1000 characters (minimum 5)</small>
        </label>
        {canEdit && <button className="ss-primary" type="submit"
          disabled={busy || !changed || !rateValid(draft.lot_owner) ||
            !rateValid(draft.homeowner) || effectiveFrom <= manilaToday() ||
            reason.trim().length < 5}>
          {busy ? 'Saving...' : 'Save new rates'}
        </button>}
        <p className="ss-info">Changes are future-dated and versioned. Earlier rules remain intact.</p>
      </form>

      <form className="lps-months-form" onSubmit={saveMonths}>
        <h3>First penalty timing</h3>
        <label className="ss-field">
          <span>Months before first penalty</span>
          <input type="number" min="1" max="600" step="1"
            value={months} disabled={!canEdit || busy}
            onChange={(e) => setMonths(e.target.value)} />
        </label>
        {canEdit && <button className="ss-primary" type="submit" disabled={busy}>
          Save timing
        </button>}
        <p className="ss-info">This setting applies to newly created penalty schedules.</p>
      </form>

      {message && <div className={`ss-message ${message.type}`}
        role={message.type === 'error' ? 'alert' : 'status'}>
        {message.text}
      </div>}
    </div>
  )
}
