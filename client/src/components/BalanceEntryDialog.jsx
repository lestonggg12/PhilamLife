import React, { useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { parsePositiveAmount } from '../lib/lotDues'
import { balanceEntryRequest, submitBalanceEntry } from '../lib/balanceEntrySubmission'
import DateField from './DateField'
import Select from './Select'

const CATEGORIES = [
  'Association Dues',
  'Special Assessment',
  'Sticker / ID Fee',
  'Document / Certification Fee',
]

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

function todayInManila() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Adds a carried-forward balance to a homeowner (for example an old unpaid
 * amount, including penalties already calculated in the verified HOA records).
 * The server applies its current annual penalty and overdue rules.
 */
export default function BalanceEntryDialog({ property, currentUser, onClose, onSaved }) {
  const today = todayInManila()
  const [category, setCategory] = useState(CATEGORIES[0])
  const [amount, setAmount] = useState('')
  const [asOf, setAsOf] = useState(today)
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const pending = useRef(new Map())
  const [acknowledged, setAcknowledged] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (submitting.current) return

    const parsed = parsePositiveAmount(amount, 'Balance amount', { maxInt: 10 })
    if (parsed.error) return setError(parsed.error)
    if (!asOf) return setError('Choose the “as of” date.')
    if (asOf > today) return setError('The “as of” date cannot be in the future.')
    if (asOf < '1990-01-01') return setError('The “as of” date is too far in the past.')

    if (!acknowledged) return setError('Confirm that you checked the date and balance amount.')
    if (!currentUser?.id) return setError('Your staff session is unavailable. Sign in and try again.')

    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const payload = {
        property_id: property.id,
        category,
        amount: parsed.value,
        as_of_date: asOf,
        description: description.trim() || null,
      }
      const request = await balanceEntryRequest(payload, currentUser.id, pending.current)
      await submitBalanceEntry(supabase, payload, currentUser.id, request.id)
      request.clear()
      onSaved(`Balance entry of ${peso.format(Number(parsed.value))} saved for ${property.homeowner_name}. Check Balance Breakdown for the updated amount due.`)
    } catch (failure) {
      setError(`${failure.message} To retry this submission, keep the same form values.`)
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  return (
    <div className="hod-backdrop" onMouseDown={() => !saving && onClose()}>
      <form className="hod-modal" onSubmit={handleSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="hod-heading">
          <div>
            <h2>Add balance</h2>
            <p>{property.homeowner_name} — {property.block}, Lot {property.lot_number}</p>
          </div>
          <button type="button" className="hod-close" onClick={onClose} aria-label="Close" disabled={saving}>×</button>
        </div>

        <label htmlFor="be-category">Category</label>
        <Select ariaLabel="Category" value={category} onChange={(value) => { setCategory(value); setError(''); setAcknowledged(false) }} options={CATEGORIES.map((name) => ({ value: name, label: name }))} />

        <div className="hod-row">
          <div>
            <label htmlFor="be-amount">Balance amount (₱)</label>
            <input
              id="be-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setError(''); setAcknowledged(false) }}
              placeholder="e.g., 80000"
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="be-asof">Balance as of</label>
            <DateField ariaLabel="As of" name="as_of_date" value={asOf} min="1990-01-01" max={today} onChange={(value) => { setAsOf(value); setError(''); setAcknowledged(false) }} required />
          </div>
        </div>

        <label htmlFor="be-description">Description (optional)</label>
        <textarea
          id="be-description"
          rows="2"
          maxLength="250"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="e.g., Balance from March 2017 up to April 2025"
        />

        <p className="hod-note">
          Enter the verified outstanding balance. This date affects overdue aging and can set the
          penalty anniversary for eligible dues. Saving checks for penalties already due and may add them immediately.
        </p>
        <label className="hod-note">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} required />
          I verified the amount and the date, including the period covered by any penalties already recorded.
        </label>

        {error && <p className="hod-error">{error}</p>}

        <div className="hod-actions">
          <button type="button" className="hod-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="hod-save" disabled={saving}>{saving ? 'Saving…' : 'Add balance'}</button>
        </div>
      </form>
    </div>
  )
}