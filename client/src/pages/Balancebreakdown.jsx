import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatPercent, penaltyLabel } from '../lib/latepenalty'
import './BalanceBreakdown.css'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

function formatDay(value) {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
}

const cents = (value) => Math.round((Number(value) || 0) * 100)

/**
 * What a homeowner owes, split into entered balances, yearly late penalties and
 * unpaid monthly dues. All amounts come from the database views; nothing is
 * calculated here.
 *
 *  postDue   - first ask the database to post any penalty that has fallen due
 *  compact   - read-only version for the Record Payment screen (hidden when the
 *              homeowner has no entered balance or penalties)
 *  canManage - Admin/Secretary can void an entered balance
 */
export default function BalanceBreakdown({
  propertyId,
  canManage = false,
  compact = false,
  postDue = false,
  refreshKey = 0,
  onChanged,
  onPosted,
}) {
  const [items, setItems] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPenalties, setShowPenalties] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const [voidTarget, setVoidTarget] = useState(null)
  const [voidReason, setVoidReason] = useState('')
  const [voidError, setVoidError] = useState('')
  const [voiding, setVoiding] = useState(false)

  const onPostedRef = useRef(onPosted)
  onPostedRef.current = onPosted

  useEffect(() => {
    if (!propertyId) {
      setItems([])
      setSummary(null)
      return undefined
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      if (postDue) {
        const { data: posted, error: postError } = await supabase.rpc('post_due_penalties', {
          p_property_id: Number(propertyId),
        })
        if (cancelled) return
        if (postError) setError(`Could not check for due penalties: ${postError.message}`)
        else if (Number(posted) > 0 && onPostedRef.current) onPostedRef.current(Number(posted))
      }

      const [itemsResult, summaryResult] = await Promise.all([
        supabase
          .from('property_balance_items')
          .select('kind, ref_id, category, item_date, label, original, unpaid, penalty_no, rate, base_amount')
          .eq('property_id', Number(propertyId))
          .order('item_date'),
        supabase
          .from('homeowner_balance_breakdown')
          .select('*')
          .eq('property_id', Number(propertyId))
          .maybeSingle(),
      ])
      if (cancelled) return

      const failure = itemsResult.error || summaryResult.error
      if (failure) setError(`Could not load the balance breakdown: ${failure.message}`)
      setItems(itemsResult.data || [])
      setSummary(summaryResult.data || null)
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [propertyId, postDue, refreshKey, reloadTick])

  async function confirmVoid(event) {
    event.preventDefault()
    const reason = voidReason.trim()
    if (reason.length < 5) {
      setVoidError('Enter a reason (at least 5 characters).')
      return
    }
    setVoiding(true)
    setVoidError('')
    const { data, error: updateError } = await supabase
      .from('balance_entries')
      .update({ voided_at: new Date().toISOString(), void_reason: reason })
      .eq('id', voidTarget.ref_id)
      .select('id')
    setVoiding(false)
    if (updateError || !data?.length) {
      setVoidError(updateError?.message || 'Could not void this balance. You may not have permission.')
      return
    }
    setVoidTarget(null)
    setVoidReason('')
    setReloadTick((tick) => tick + 1)
    if (onChanged) onChanged(`Balance voided. Its late penalties were voided with it.`)
  }

  if (!propertyId) return null

  const entries = items.filter((item) => item.kind === 'entry')
  const penalties = items.filter((item) => item.kind === 'penalty')
  const duesTotal = Number(summary?.unpaid_dues_total) || 0
  const hasContent = entries.length > 0 || penalties.length > 0

  if (!hasContent) {
    if (loading || !error) return null
    return <p className="bb-error">{error}</p>
  }

  const penaltyTitle = summary ? penaltyLabel({
    penalties_count: summary.penalties_posted_count,
    penalties_rated_count: summary.penalties_rated_count,
    penalties_outstanding: summary.penalties_outstanding,
    penalties_posted_total: summary.penalties_posted_total,
    rate_min: summary.penalty_rate_min,
    rate_max: summary.penalty_rate_max,
  }) : ''

  return (
    <section className={`bb${compact ? ' bb-compact' : ''}`} aria-label="Balance breakdown">
      <header className="bb-head">
        <h3>Balance breakdown</h3>
        {loading && <small>Updating…</small>}
      </header>

      {error && <p className="bb-error">{error}</p>}

      {entries.length > 0 && (
        <div className="bb-block">
          <h4>Entered balance</h4>
          {entries.map((entry) => (
            <div className="bb-row" key={entry.ref_id}>
              <div className="bb-main">
                <strong>{entry.label}</strong>
                <small>{entry.category} · as of {formatDay(entry.item_date)}</small>
              </div>
              <div className="bb-amounts">
                <strong>{peso.format(Number(entry.unpaid) || 0)}</strong>
                {cents(entry.unpaid) !== cents(entry.original) && (
                  <small>of {peso.format(Number(entry.original) || 0)}</small>
                )}
              </div>
              {canManage && !compact && (
                <button type="button" className="bb-link" onClick={() => { setVoidTarget(entry); setVoidReason(''); setVoidError('') }}>
                  Void
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {penalties.length > 0 && (
        <div className="bb-block">
          <div className="bb-row">
            <div className="bb-main">
              <strong>{penaltyTitle || 'Late penalties'}</strong>
              <small>
                <button type="button" className="bb-link" onClick={() => setShowPenalties((open) => !open)}>
                  {showPenalties ? 'Hide each year' : 'Show each year'}
                </button>
              </small>
            </div>
            <div className="bb-amounts">
              <strong>{peso.format(Number(summary?.penalties_outstanding) || 0)}</strong>
            </div>
          </div>
          {showPenalties && (
            <ul className="bb-lines">
              {penalties.map((penalty) => (
                <li key={penalty.ref_id}>
                  <span>
                    {penalty.penalty_no ? `Year ${penalty.penalty_no} · ` : ''}{formatDay(penalty.item_date)}
                    {penalty.rate != null && penalty.base_amount != null
                      ? ` · ${formatPercent(penalty.rate)} of ${peso.format(Number(penalty.base_amount) || 0)}`
                      : ''}
                  </span>
                  <strong>{peso.format(Number(penalty.original) || 0)}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {duesTotal > 0 && (
        <div className="bb-row">
          <div className="bb-main">
            <strong>Unpaid monthly dues</strong>
            <small>{summary?.unpaid_dues_months} month{Number(summary?.unpaid_dues_months) === 1 ? '' : 's'}</small>
          </div>
          <div className="bb-amounts"><strong>{peso.format(duesTotal)}</strong></div>
        </div>
      )}

      <div className="bb-row bb-total">
        <div className="bb-main"><strong>Total due</strong></div>
        <div className="bb-amounts"><strong>{peso.format(Number(summary?.grand_total_due) || 0)}</strong></div>
      </div>

      {voidTarget && (
        <form className="bb-void" onSubmit={confirmVoid}>
          <strong>Void “{voidTarget.label}”?</strong>
          <p>Its late penalties will be voided and the balance reduced. This cannot be undone.</p>
          <textarea
            value={voidReason}
            onChange={(event) => { setVoidReason(event.target.value); setVoidError('') }}
            rows="2"
            maxLength="250"
            placeholder="Reason (required)"
            autoFocus
          />
          {voidError && <p className="bb-error">{voidError}</p>}
          <div className="bb-void-actions">
            <button type="button" onClick={() => setVoidTarget(null)} disabled={voiding}>Cancel</button>
            <button type="submit" className="bb-danger" disabled={voiding}>{voiding ? 'Voiding…' : 'Void balance'}</button>
          </div>
        </form>
      )}
    </section>
  )
}