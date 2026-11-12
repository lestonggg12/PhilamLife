import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const format = value => php.format(Number(value || 0))
const toCents = value => Math.round(Number(value || 0) * 100)

export default function BankDepositReceiptMatcher({ deposit, onChanged }) {
  const [links, setLinks] = useState([])
  const [receipt, setReceipt] = useState('')
  const [kind, setKind] = useState('payment')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const matched = links.filter(link => link.active).reduce((sum, link) => sum + toCents(link.amount), 0)
  const remaining = toCents(deposit.amount) - matched

  const refreshLinks = useCallback(async () => {
    const { data, error: loadError } = await supabase.from('bank_deposit_receipt_links')
      .select('id,amount,active,payment_id,service_transaction_id,created_at')
      .eq('deposit_id', deposit.id).eq('active', true)
      .order('created_at', { ascending: true })
    if (loadError) throw loadError
    setLinks(data || [])
  }, [deposit.id])

  useEffect(() => {
    let mounted = true
    refreshLinks().catch(err => { if (mounted) setError(err.message) })
    return () => { mounted = false }
  }, [refreshLinks])

  async function search(event) {
    event.preventDefault()
    if (!receipt.trim()) return
    setBusy(true)
    setError('')
    setResults([])
    setSelected('')
    try {
      const table = kind === 'payment' ? 'payments' : 'service_transactions'
      const fields = kind === 'payment'
        ? 'id,receipt_number,amount_paid,amount,payment_method,status,voided_at'
        : 'id,receipt_number,amount_paid,payment_method,payment_status,voided_at'
      const { data, error: queryError } = await supabase.from(table)
        .select(fields).eq('receipt_number', receipt.trim()).limit(10)
      if (queryError) throw queryError
      const eligible = (data || []).filter(row =>
        row.voided_at === null && String(row.payment_method).toLowerCase() === 'cash' &&
        (kind === 'payment' ? row.status === 'Completed'
          : ['paid', 'completed'].includes(String(row.payment_status).toLowerCase())))
      setResults(eligible)
      if (!eligible.length) setMessage('No eligible unvoided cash receipt found. Check the receipt number.')
      else setMessage('Select a receipt and enter the amount to match.')
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function link(event) {
    event.preventDefault()
    const cents = toCents(amount)
    if (!selected || !/^\d+(\.\d{1,2})?$/.test(amount) || cents <= 0 || cents > remaining) {
      setError('Select a receipt and enter an amount within the deposit remaining balance.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('link_bank_deposit_receipt', {
        p_deposit_id: deposit.id,
        p_payment_id: kind === 'payment' ? Number(selected) : null,
        p_service_transaction_id: kind === 'service' ? selected : null,
        p_amount: Number(amount),
      })
      if (rpcError) throw rpcError
      await refreshLinks()
      setResults([])
      setSelected('')
      setAmount('')
      setMessage('Receipt linked. Verify the matching total before clearing the deposit.')
      onChanged?.()
    } catch (err) { setError(err.message || 'Could not match receipt.') }
    finally { setBusy(false) }
  }

  async function unlink(linkId) {
    const reason = window.prompt('Reason for removing this match (at least 5 characters):')
    if (reason === null) return
    if (reason.trim().length < 5) { setError('Provide at least five characters.'); return }
    if (!window.confirm('Remove this receipt match? The removal will be audited.')) return
    setBusy(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('unlink_bank_deposit_receipt', {
        p_link_id: linkId, p_reason: reason.trim(),
      })
      if (rpcError) throw rpcError
      await refreshLinks()
      setMessage('Match removed and audit evidence preserved.')
      onChanged?.()
    } catch (err) { setError(err.message || 'Could not remove match.') }
    finally { setBusy(false) }
  }

  return (
    <details style={{ marginTop: '0.5rem' }}>
      <summary>Match receipts ({format(matched / 100)} / {format(deposit.amount)})</summary>
      <p role="status">Remaining unmatched: <strong>{format(remaining / 100)}</strong>. Final reconciliation is still disabled pending end-to-end testing.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <ul>{links.map(link => <li key={link.id}>
        {link.payment_id ? `Homeowner payment #${link.payment_id}` : `Service receipt ${link.service_transaction_id}`} — {format(link.amount)}{' '}
        <button type="button" disabled={busy} onClick={() => unlink(link.id)}>Remove match</button>
      </li>)}</ul>
      <form onSubmit={search}>
        <label>Receipt type <select value={kind} disabled={busy} onChange={e => { setKind(e.target.value); setResults([]); setSelected('') }}>
          <option value="payment">Homeowner receipt</option><option value="service">Service receipt</option>
        </select></label>{' '}
        <label>Exact receipt number <input value={receipt} required maxLength={100} onChange={e => setReceipt(e.target.value)} /></label>{' '}
        <button type="submit" disabled={busy}>Find receipt</button>
      </form>
      {results.length > 0 && <form onSubmit={link}>
        <label>Eligible receipt <select required value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">Select receipt</option>
          {results.map(r => <option key={r.id} value={r.id}>
            {r.receipt_number} — {format(r.amount_paid ?? r.amount)} paid
          </option>)}
        </select></label>{' '}
        <label>Amount to match (PHP) <input type="number" required min="0.01" step="0.01" max={(remaining / 100).toFixed(2)} value={amount} onChange={e => setAmount(e.target.value)} /></label>{' '}
        <button disabled={busy || remaining <= 0 || !selected}>Link receipt</button>
      </form>}
    </details>
  )
}
