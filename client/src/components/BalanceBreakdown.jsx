import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { formatPercent } from '../lib/latepenalty'
import './BalanceBreakdown.css'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

function formatDay(value) {
  if (!value) return '—'
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
}

const cents = (value) => Math.round((Number(value) || 0) * 100)
const money = (value) => peso.format(cents(value) / 100)
const reduction = (value) => value > 0 ? `−${peso.format(value / 100)}` : '—'

const itemTypes = {
  entry: 'Entered balance',
  opening: 'Opening balance',
  dues: 'Monthly dues',
  penalty: 'Late penalty',
  charge: 'Other charge',
  adjustment: 'Account adjustment',
}

function BreakdownCell({ label, children }) {
  return (
    <td role="cell" className="bb-labeled-cell">
      <span className="bb-cell-label" aria-hidden="true">{label}</span>
      <span>{children}</span>
    </td>
  )
}

export function BalanceItemsTable({ items, totalDue, onVoid }) {
  const amounts = items.filter((item) => cents(item.original) > 0)
  const originalTotal = amounts.reduce((sum, item) => sum + cents(item.original), 0)
  const unpaidTotal = amounts.reduce((sum, item) => sum + cents(item.unpaid), 0)
  const reconciles = unpaidTotal === cents(totalDue)

  return (
    <>
      <p className="bb-note">Payments, discounts, and other adjustments are deducted from the original amount to show what is still due.</p>
      <div className="bb-table-frame">
        <table className="bb-table" role="table" aria-label="Balance items">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Balance item</th>
              <th scope="col" role="columnheader">Original amount</th>
              <th scope="col" role="columnheader">Payments &amp; adjustments</th>
              <th scope="col" role="columnheader">Remaining due</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {amounts.map((item) => (
              <tr role="row" key={`${item.kind}-${item.ref_id}`}>
                <th scope="row" role="rowheader">
                  <strong>{item.penalty_no ? `Year ${item.penalty_no} late penalty` : item.label || itemTypes[item.kind]}</strong>
                  <small>{itemTypes[item.kind]} · {formatDay(item.item_date)}</small>
                  {item.kind !== 'dues' && item.kind !== 'adjustment' && item.category && <small>{item.category}</small>}
                  {item.kind === 'penalty' && item.rate != null && item.base_amount != null && (
                    <small>{formatPercent(item.rate)} of {money(item.base_amount)}</small>
                  )}
                  {onVoid && item.kind === 'entry' && (
                    <button type="button" className="bb-link" aria-label={`Void ${item.label || 'entered balance'}`} onClick={() => onVoid(item)}>Void balance</button>
                  )}
                </th>
                <BreakdownCell label="Original amount">{money(item.original)}</BreakdownCell>
                <BreakdownCell label="Payments &amp; adjustments">{reduction(cents(item.original) - cents(item.unpaid))}</BreakdownCell>
                <BreakdownCell label="Remaining due"><strong>{money(item.unpaid)}</strong></BreakdownCell>
              </tr>
            ))}
            {amounts.length === 0 && <tr role="row"><td role="cell" colSpan={4} className="bb-table-empty">No positive balance items recorded.</td></tr>}
          </tbody>
          <tfoot role="rowgroup">
            <tr role="row">
              <th scope="row" role="rowheader">Total due</th>
              <BreakdownCell label="Original total">{reconciles ? peso.format(originalTotal / 100) : '—'}</BreakdownCell>
              <BreakdownCell label="Total payments &amp; adjustments">{reconciles ? reduction(originalTotal - unpaidTotal) : '—'}</BreakdownCell>
              <BreakdownCell label="Remaining due"><strong>{money(totalDue)}</strong></BreakdownCell>
            </tr>
          </tfoot>
        </table>
      </div>
      {!reconciles && <p className="bb-error" role="status">The items and account total differ. Refresh this breakdown before relying on the individual amounts.</p>}
    </>
  )
}

export function BalanceReductionHistory({ payments, adjustments, error }) {
  const paymentRows = payments
    .filter((payment) => payment.status !== 'Voided')
    .map((payment) => ({
      id: `payment-${payment.id}`,
      label: payment.receipt_number || 'Payment (no receipt number recorded)',
      type: `Payment · ${payment.charge_type || 'Unspecified category'}`,
      date: payment.payment_date,
      amount: cents(payment.balance_effect) - cents(payment.effect_released),
    }))
    .filter((payment) => payment.amount > 0)
  const records = [
    ...paymentRows,
    ...adjustments.map((item) => ({
      id: `${item.kind}-${item.ref_id}`,
      label: item.label || 'Account adjustment',
      type: 'Recorded adjustment',
      date: item.item_date,
      amount: -cents(item.original),
    })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  return (
    <details className="bb-history">
      <summary>Trace payments and adjustments</summary>
      <p className="bb-note">These records already affect the account balance. Use the receipt numbers to trace the payments. The breakdown shows reductions per item without assigning individual receipts to them.</p>
      {error && <p className="bb-error" role="status">Payment receipts could not be loaded. Recorded adjustments are shown below.</p>}
      <div className="bb-table-frame">
        <table className="bb-table bb-history-table" role="table" aria-label="Payments and adjustments that reduced the balance">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">Record</th>
              <th scope="col" role="columnheader">Date</th>
              <th scope="col" role="columnheader">Balance reduction</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {records.map((record) => (
              <tr role="row" key={record.id}>
                <th scope="row" role="rowheader"><strong>{record.label}</strong><small>{record.type}</small></th>
                <BreakdownCell label="Date">{formatDay(record.date)}</BreakdownCell>
                <BreakdownCell label="Balance reduction">{reduction(record.amount)}</BreakdownCell>
              </tr>
            ))}
            {!error && records.length === 0 && (
              <tr role="row"><td role="cell" colSpan={3} className="bb-table-empty">No payment or adjustment reductions recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </details>
  )
}

/**
 * Explain the database's balance items and account total. Displayed reductions
 * compare the original and unpaid amounts, without allocating payments in the UI.
 *
 *  postDue   - first ask the database to post any penalty that has fallen due
 *  compact   - read-only version for the Record Payment screen (hidden when the
 *              homeowner has no recorded balance items)
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
  const [payments, setPayments] = useState([])
  const [paymentError, setPaymentError] = useState(false)
  const [summary, setSummary] = useState(null)
  const [transferCreditDetails, setTransferCreditDetails] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
      setPayments([])
      setPaymentError(false)
      setSummary(null)
      setTransferCreditDetails([])
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

      const [itemsResult, summaryResult, transfersResult, paymentsResult] = await Promise.all([
        fetchAll(() => supabase
          .from('property_balance_items')
          .select('kind, ref_id, category, item_date, label, original, unpaid, penalty_no, rate, base_amount')
          .eq('property_id', Number(propertyId))
          .order('item_date', { nullsFirst: true })
          .order('kind'), { tiebreaker: 'ref_id' }),
        supabase
          .from('homeowner_balance_breakdown')
          .select('*')
          .eq('property_id', Number(propertyId))
          .maybeSingle(),
        supabase.from('homeowner_balance_transfers')
          .select('id,previous_property_id,transferred_balance,effective_date,note')
          .eq('new_property_id', Number(propertyId)),
        fetchAll(() => supabase.from('payments')
          .select('id,receipt_number,payment_date,charge_type,status,balance_effect,effect_released')
          .eq('property_id', Number(propertyId))
          .gt('balance_effect', 0)
          .order('payment_date')),
      ])
      if (cancelled) return

      const failure = itemsResult.error || summaryResult.error || transfersResult.error
      if (failure) setError(`Could not load the balance breakdown: ${failure.message}`)
      setItems(itemsResult.data || [])
      setSummary(itemsResult.error || summaryResult.error ? null : summaryResult.data || null)
      setPayments(paymentsResult.data || [])
      setPaymentError(Boolean(paymentsResult.error))
      if (transfersResult.error) {
        setTransferCreditDetails([])
      } else {
        const transfers = transfersResult.data || []
        if (transfers.length) {
          const { data: formerOwners, error: formerError } = await supabase
            .from('properties').select('id,homeowner_name,block,lot_number')
            .in('id', transfers.map((row) => row.previous_property_id))
          if (cancelled) return
          if (formerError) setError(`Could not load the transfer source: ${formerError.message}`)
          const byId = new Map((formerOwners || []).map((row) => [String(row.id), row]))
          setTransferCreditDetails(transfers.map((row) => ({ ...row, formerOwner: byId.get(String(row.previous_property_id)) || null })))
        } else {
          setTransferCreditDetails([])
        }
      }
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

  const transferIds = transferCreditDetails.map((transfer) => String(transfer.id).toLowerCase())
  const isIncomingTransfer = (item) => item.kind === 'adjustment' &&
    transferIds.some((id) => String(item.label || '').toLowerCase().includes(id))
  const balanceItems = items.map((item) => isIncomingTransfer(item) && cents(item.original) > 0
    ? { ...item, label: 'Outstanding balance carried over' }
    : item)
  const reductions = items.filter((item) => cents(item.original) < 0 && !isIncomingTransfer(item))

  if (compact && !loading && !error && !items.length && !transferCreditDetails.length && !cents(summary?.current_balance)) return null

  function startVoid(entry) {
    setVoidTarget(entry)
    setVoidReason('')
    setVoidError('')
  }

  return (
    <section className={`bb${compact ? ' bb-compact' : ''}`} aria-label="Balance breakdown" aria-busy={loading}>
      <header className="bb-head">
        <h3>How the balance adds up</h3>
        {loading && <small>Loading…</small>}
      </header>

      {error && <p className="bb-error" role="status">{error}</p>}
      {!loading && summary && (
        <>
          <BalanceItemsTable items={balanceItems} totalDue={summary.grand_total_due} onVoid={canManage && !compact ? startVoid : undefined} />
          <BalanceReductionHistory payments={payments} adjustments={reductions} error={paymentError} />
        </>
      )}
      {!loading && !summary && !error && <p className="bb-note">Balance details are unavailable for this property.</p>}

      {!loading && transferCreditDetails.length > 0 && (
        <div className="bb-block bb-transfer-block">
          <h4>Balance or credit received at ownership transfer</h4>
          {transferCreditDetails.map((transfer) => {
            const amount = Number(transfer.transferred_balance)
            const isCredit = amount < 0
            const previous = transfer.formerOwner
            return (
              <div className="bb-transfer-detail" key={transfer.id}>
                <div className="bb-row">
                  <div className="bb-main">
                    <strong>{isCredit ? 'Advance credit carried over' : amount > 0 ? 'Outstanding debt carried over' : 'No balance carried over'}</strong>
                    <small>From {previous?.homeowner_name || 'former owner'}{previous?.block ? ` · ${previous.block}, Lot ${previous.lot_number}` : ''}</small>
                    <small>Transfer effective {formatDay(transfer.effective_date)}</small>
                  </div>
                  <div className="bb-amounts"><strong>{peso.format(Math.abs(amount))}</strong></div>
                </div>
                <p className="bb-transfer-explanation">
                  {isCredit
                    ? 'This amount was received as advance credit, not a debt or a new payment. Subsequent dues or charges may use the credit.'
                    : amount > 0
                      ? 'This amount was received as an outstanding obligation of the transferred lot. It is not a payment.'
                      : 'This ownership transfer carried no outstanding debt or advance credit.'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {!loading && Number(summary?.current_balance) < 0 && (
        <div className="bb-row bb-credit-total">
          <div className="bb-main"><strong>Available advance credit on this account</strong><small>Current net account credit, including any transfer and subsequent activity</small></div>
          <div className="bb-amounts"><strong>{peso.format(-Number(summary.current_balance))}</strong></div>
        </div>
      )}

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
            <button type="button" className="button-cancel" onClick={() => setVoidTarget(null)} disabled={voiding}>Cancel</button>
            <button type="submit" className="bb-danger" disabled={voiding}>{voiding ? 'Voiding…' : 'Void balance'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
