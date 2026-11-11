import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatRate, parsePositiveAmount } from '../lib/lotDues'
import { monthLabel } from '../lib/pagedQuery'
import DateField from './DateField'
import './PricePerSqmForm.css'
import Skeleton from './skeleton/Skeleton'
import { useConfirm } from './ConfirmDialog'

const manilaMonth = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit',
}).format(new Date())

async function readRateSchedule() {
  const [status, rates, settings] = await Promise.all([
    supabase.from('association_dues_rate_status').select('next_month, next_rate').single(),
    supabase.from('association_dues_rates').select('effective_month, price_per_sqm').order('effective_month'),
    supabase.from('system_settings').select('price_per_sqm').eq('id', 1).single(),
  ])
  if (status.error || rates.error || settings.error) throw status.error || rates.error || settings.error
  if (!status.data?.next_month || !Array.isArray(rates.data) || !settings.data) {
    throw new Error('Billing schedule unavailable.')
  }
  const currentMonth = manilaMonth()
  const applicable = rates.data.filter((row) => row.effective_month.slice(0, 7) <= currentMonth)
  return {
    nextMonth: status.data.next_month.slice(0, 7),
    nextRate: status.data.next_rate,
    currentMonth,
    currentRate: applicable.length ? applicable.at(-1).price_per_sqm : settings.data.price_per_sqm,
    rates: rates.data,
  }
}

export default function PricePerSqmForm({ canEdit = false }) {
  const confirm = useConfirm()
  const [schedule, setSchedule] = useState(null)
  const [effectiveMonth, setEffectiveMonth] = useState('')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const resetDraft = (state) => {
    if (!state) return
    setEffectiveMonth(state.nextMonth)
    setInput(state.nextRate == null ? '' : String(state.nextRate))
  }
  const refresh = async () => {
    const state = await readRateSchedule()
    setSchedule(state)
    resetDraft(state)
    return state
  }

  useEffect(() => {
    let active = true
    readRateSchedule().then((state) => {
      if (!active) return
      setSchedule(state)
      resetDraft(state)
    }).catch((error) => {
      if (active) setMessage({ type: 'error', text: error?.message || 'Unable to load the rate schedule.' })
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const validRate = () => {
    const parsed = parsePositiveAmount(input, 'Price per square meter', { maxInt: 10 })
    if (parsed.error) { setMessage({ type: 'error', text: parsed.error }); return null }
    return parsed.value
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canEdit || !schedule || saving) return
    const rate = validRate()
    if (rate == null) return
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth) || effectiveMonth < schedule.nextMonth) {
      setMessage({ type: 'error', text: 'Choose an unbilled future month.' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const approved = await confirm({
        title: 'Schedule the association dues rate?',
        message: `${formatRate(rate)} takes effect in ${monthLabel(effectiveMonth)} for new bills. Issued bills and prepaid contracted months keep their amounts.`,
        confirmLabel: 'Schedule rate', cancelLabel: 'Cancel',
      })
      if (!approved) return
      const { error } = await supabase.rpc('schedule_association_dues_rate', {
        p_rate: rate, p_effective_month: `${effectiveMonth}-01`,
      })
      if (error) throw error
      const text = `Rate scheduled for ${monthLabel(effectiveMonth)}.`
      setMessage({ type: 'success', text })
      notifySuccess(text)
      try { await refresh() } catch { setMessage({ type: 'success', text: `${text} Reload the page to refresh the schedule.` }) }
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to schedule the rate.' })
    } finally { setSaving(false) }
  }

  async function handleApplyNow() {
    if (!canEdit || !schedule || saving) return
    const rate = validRate()
    if (rate == null) return
    setSaving(true)
    setMessage(null)
    try {
      const approved = await confirm({
        title: 'Apply association dues rate now?',
        message: `${formatRate(rate)} will apply to ${monthLabel(schedule.currentMonth)} immediately. Already-issued current-month dues for non-prepaid accounts will be adjusted, with balance changes and an audit trail. Contracted prepaid prices stay fixed. Future scheduled rates, if any, will still take effect in their scheduled months.`,
        confirmLabel: 'Apply now', cancelLabel: 'Cancel',
      })
      if (!approved) return
      const { data, error } = await supabase.rpc('apply_association_dues_rate_now', { p_rate: rate })
      if (error) throw error
      const adjusted = Number(data?.adjusted_charges ?? 0)
      const text = `Rate applied now for ${monthLabel(schedule.currentMonth)}. ${adjusted} issued dues charge${adjusted === 1 ? '' : 's'} adjusted; prepaid contract prices preserved.`
      setMessage({ type: 'success', text })
      notifySuccess(text)
      try { await refresh() } catch { setMessage({ type: 'success', text: `${text} Reload the page to refresh the schedule.` }) }
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Rate change could not be verified. Refresh the page before retrying to avoid a duplicate adjustment.' })
    } finally { setSaving(false) }
  }

  async function handleCancelSchedule(month) {
    if (!canEdit || !schedule || saving) return
    setSaving(true)
    setMessage(null)
    try {
      const approved = await confirm({
        title: `Cancel the ${monthLabel(month)} dues rate?`,
        message: `This removes the unapplied scheduled rate for ${monthLabel(month)}. Bills already issued are not changed; the previous applicable rate will be used instead unless another schedule applies.`,
        confirmLabel: 'Cancel schedule', cancelLabel: 'Keep rate',
      })
      if (!approved) return
      const { error } = await supabase.rpc('cancel_scheduled_association_dues_rate', { p_effective_month: `${month}-01` })
      if (error) throw error
      const text = `${monthLabel(month)} scheduled rate cancelled.`
      setMessage({ type: 'success', text })
      notifySuccess(text)
      try { await refresh() } catch { setMessage({ type: 'success', text: `${text} Reload the page to refresh the schedule.` }) }
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Could not cancel the scheduled rate.' })
    } finally { setSaving(false) }
  }

  if (loading) return (
    <div className="ss-field wide" aria-busy="true">
      <Skeleton variant="text" width="64%" />
      <Skeleton variant="rect" width="100%" height="40px" />
      <span className="skeleton-region-status" role="status">Loading</span>
    </div>
  )

  return (
    <form onSubmit={handleSubmit} className="ss-field wide">
      {schedule && <>
        <span>Current month ({monthLabel(schedule.currentMonth)}) <strong>{formatRate(schedule.currentRate)}</strong></span>
        <span>Next unbilled month ({monthLabel(schedule.nextMonth)}) <strong>{formatRate(schedule.nextRate)}</strong></span>
        {schedule.rates.filter((rate) => rate.effective_month.slice(0, 7) >= schedule.nextMonth).map((rate) => {
          const month = rate.effective_month.slice(0, 7)
          return <div key={rate.effective_month} className="ss-dues-scheduled-row">
            <span>{monthLabel(month)} · {formatRate(rate.price_per_sqm)}</span>
            {canEdit && <button type="button" className="ss-dues-cancel" disabled={saving}
              onClick={() => handleCancelSchedule(month)} aria-label={`Cancel ${monthLabel(month)} scheduled rate`}>
              Cancel schedule
            </button>}
          </div>
        })}
      </>}
      {canEdit && schedule && <>
        <label className="ss-field">
          <span>Price per square meter (₱)</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" required
            value={input} onChange={(event) => { setInput(event.target.value); setMessage(null) }}
            onWheel={(event) => event.currentTarget.blur()} disabled={saving} placeholder="e.g., 6.00" />
        </label>
        <div className="ss-field">
          <span>Effective billing month for scheduling</span>
          <DateField value={effectiveMonth} onChange={(value) => { setEffectiveMonth(value); setMessage(null) }}
            min={`${schedule.nextMonth}-01`} monthOnly clearable={false} disabled={saving}
            placeholder="Choose billing month" ariaLabel="Effective dues billing month" required />
        </div>
        <div className="ss-dues-actions">
          <button type="button" className="ss-dues-secondary" disabled={saving}
            onClick={() => { resetDraft(schedule); setMessage(null) }}>Cancel edit</button>
          <button type="submit" className="ss-primary" disabled={saving}>{saving ? 'Saving…' : 'Schedule rate'}</button>
          <button type="button" className="ss-primary ss-dues-now" disabled={saving}
            onClick={handleApplyNow}>{saving ? 'Saving…' : 'Effective now'}</button>
        </div>
        <p className="ss-info">Effective now reconciles this month's issued dues. Future schedules can be cancelled above; prepaid contract prices stay unchanged.</p>
      </>}
      {message && <div className={`ss-message ${message.type}`} role="status">{message.text}</div>}
      {!canEdit && <p className="ss-info">Only an Admin can change or cancel the dues rate.</p>}
    </form>
  )
}
