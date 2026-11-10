import { notifySuccess } from '../lib/actionFeedback'
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatRate, parsePositiveAmount } from '../lib/lotDues'
import Skeleton from './skeleton/Skeleton'
import { useConfirm } from './ConfirmDialog'

export default function PricePerSqmForm({ canEdit = false }) {
  const confirm = useConfirm()
  const [current, setCurrent] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessageState] = useState(null)
  function setMessage(next) {
    setMessageState(next)
    if (next?.type === 'success') notifySuccess(next.text)
  }

  useEffect(() => {
    let active = true
    async function load() {
      const { data, error } = await supabase
        .from('system_settings')
        .select('price_per_sqm')
        .eq('id', 1)
        .maybeSingle()
      if (!active) return
      if (error) {
        setMessage({ type: 'error', text: `Unable to load the rate: ${error.message}` })
      } else {
        const rate = data?.price_per_sqm ?? null
        setCurrent(rate)
        setInput(rate == null ? '' : String(rate))
      }
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (saving) return
    if (!canEdit) {
      setMessage({ type: 'error', text: 'Only an Admin can change the price per square meter.' })
      return
    }
    const parsed = parsePositiveAmount(input, 'Price per square meter', { maxInt: 10 })
    if (parsed.error) {
      setMessage({ type: 'error', text: parsed.error })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const approved = await confirm({
        title: 'Apply the monthly dues rate?',
        message: `${formatRate(parsed.value)} applies to current-month bills for all active lots, including bills already paid. A rate increase can add to the balance due. A reduction can leave account credit.`,
        confirmLabel: 'Apply rate',
        cancelLabel: 'Cancel',
      })
      if (!approved) return
      const { data, error } = await supabase.rpc('set_price_per_sqm', { p_rate: parsed.value })
      if (error) throw error
      setCurrent(data)
      setInput(String(data))
      setMessage({ type: 'success', text: 'Rate saved and current-month dues updated.' })
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to confirm the rate update. Refresh before retrying.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="ss-field wide" aria-busy="true">
        <Skeleton variant="text" width="46%" />
        <Skeleton variant="text" width="64%" />
        <Skeleton variant="rect" width="100%" height="40px" />
        <Skeleton variant="rect" width="120px" height="40px" />
        <span className="skeleton-region-status" role="status">Loading</span>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="ss-field wide">
      <span>Current rate: <strong>{formatRate(current)}</strong></span>
      <label className="ss-field">
        <span>Price per square meter (₱)</span>
        <input
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={input}
          onChange={(event) => { setInput(event.target.value); setMessage(null) }}
          onWheel={(event) => event.currentTarget.blur()}
          disabled={!canEdit || saving}
          placeholder="e.g., 5.00"
        />
      </label>
      {message && <div className={`ss-message ${message.type}`} role="status">{message.text}</div>}
      {canEdit ? (
        <button type="submit" className="ss-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Update rate'}
        </button>
      ) : (
        <p className="ss-info">Only an Admin can change this rate.</p>
      )}
    </form>
  )
}