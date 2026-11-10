import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatRate, parsePositiveAmount } from '../lib/lotDues'
import { monthLabel } from '../lib/pagedQuery'
import Skeleton from './skeleton/Skeleton'
import { useConfirm } from './ConfirmDialog'

async function readRateSchedule() {
  const [status, rates] = await Promise.all([
    supabase.from('association_dues_rate_status').select('next_month, next_rate').single(),
    supabase.from('association_dues_rates').select('effective_month, price_per_sqm').order('effective_month'),
  ])
  if (status.error || rates.error) throw status.error || rates.error
  if (!status.data?.next_month || !Array.isArray(rates.data)) throw new Error('Billing schedule unavailable.')
  return { nextMonth: status.data.next_month.slice(0, 7), nextRate: status.data.next_rate, rates: rates.data }
}

export default function PricePerSqmForm({ canEdit = false }) {
  const confirm = useConfirm()
  const [schedule, setSchedule] = useState(null)
  const [effectiveMonth, setEffectiveMonth] = useState('')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await readRateSchedule()
        if (!active) return
        setSchedule(result)
        setEffectiveMonth(result.nextMonth)
        setInput(result.nextRate == null ? '' : String(result.nextRate))
      } catch (error) {
        if (active) setMessage({ type: 'error', text: error?.message || 'Unable to load the rate schedule.' })
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canEdit || !schedule || saving) return
    const parsed = parsePositiveAmount(input, 'Price per square meter', { maxInt: 10 })
    if (parsed.error || !/^\d{4}-\d{2}$/.test(effectiveMonth) || effectiveMonth < schedule.nextMonth) {
      setMessage({ type: 'error', text: parsed.error || 'Choose an effective billing month.' })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const approved = await confirm({
        title: 'Schedule the association dues rate?',
        message: `${formatRate(parsed.value)} takes effect in ${monthLabel(effectiveMonth)} for new bills. Issued bills keep their amounts, and prepaid months keep their covered price.`,
        confirmLabel: 'Schedule rate',
        cancelLabel: 'Cancel',
      })
      if (!approved) return

      const { error } = await supabase.rpc('schedule_association_dues_rate', {
        p_rate: parsed.value,
        p_effective_month: `${effectiveMonth}-01`,
      })
      if (error) throw error

      const text = `Rate scheduled for ${monthLabel(effectiveMonth)}.`
      setMessage({ type: 'success', text })
      notifySuccess(text)
      try {
        const refreshed = await readRateSchedule()
        setSchedule(refreshed)
        if (effectiveMonth < refreshed.nextMonth) setEffectiveMonth(refreshed.nextMonth)
      } catch {
        setMessage({ type: 'success', text: `${text} Reload the page to refresh the schedule.` })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to confirm the rate schedule. Refresh before retrying.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="ss-field wide" aria-busy="true">
        <Skeleton variant="text" width="64%" />
        <Skeleton variant="rect" width="100%" height="40px" />
        <span className="skeleton-region-status" role="status">Loading</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="ss-field wide">
      {schedule && (
        <>
          <span>Next billing month ({monthLabel(schedule.nextMonth)}) <strong>{formatRate(schedule.nextRate)}</strong></span>
          {schedule.rates.filter(rate => rate.effective_month.slice(0, 7) >= schedule.nextMonth).map(rate => (
            <span key={rate.effective_month}>{monthLabel(rate.effective_month.slice(0, 7))} · {formatRate(rate.price_per_sqm)}</span>
          ))}
        </>
      )}
      {canEdit && schedule && (
        <>
          <label className="ss-field">
            <span>Price per square meter (₱)</span>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" required
              value={input} onChange={(event) => { setInput(event.target.value); setMessage(null) }}
              onWheel={(event) => event.currentTarget.blur()} disabled={saving} placeholder="e.g., 6.00" />
          </label>
          <label className="ss-field">
            <span>Effective billing month</span>
            <input type="month" min={schedule.nextMonth} required value={effectiveMonth}
              onChange={(event) => { setEffectiveMonth(event.target.value); setMessage(null) }} disabled={saving} />
          </label>
          <button type="submit" className="ss-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Schedule rate'}
          </button>
        </>
      )}
      {message && <div className={`ss-message ${message.type}`} role="status">{message.text}</div>}
      {!canEdit && <p className="ss-info">Only an Admin can schedule a new rate.</p>}
    </form>
  )
}
