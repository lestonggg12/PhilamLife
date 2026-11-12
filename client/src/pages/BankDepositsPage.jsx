import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import BankDepositReceiptMatcher from '../components/BankDepositReceiptMatcher'
import './BankDepositsPage.css'

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const manilaToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())
const money = (value) => currency.format(Number(value || 0))
const initial = () => ({ fund: '', depositDate: manilaToday(), bankReference: '', amount: '' })

export default function BankDepositsPage({ user }) {
  const role = String(user?.role || '').trim().toLowerCase()
  const canAdmin = role === 'admin'
  const canTreasurer = role === 'treasurer'
  const [funds, setFunds] = useState([])
  const [deposits, setDeposits] = useState([])
  const [form, setForm] = useState(initial)
  const [fundName, setFundName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const depositQuery = supabase.from('bank_deposits')
        .select('id,fund_id,deposit_date,bank_reference,amount,status,recorded_at,cleared_at,verified_by,reconciled_at,reconciled_by')
        .order('recorded_at', { ascending: false }).limit(200)
      // The Secretary has deposit read access but intentionally no fund-registry access.
      const [d, f] = await Promise.all([
        depositQuery,
        canAdmin || canTreasurer
          ? supabase.from('deposit_funds').select('id,name,active').order('name')
          : Promise.resolve({ data: [], error: null }),
      ])
      if (d.error) throw d.error
      if (f.error) throw f.error
      setDeposits(d.data || [])
      setFunds(f.data || [])
      setReady(true)
    } catch (err) {
      setReady(false)
      setError(`Bank deposits unavailable: ${err.message || 'Could not load records'}. The staging migration may not be installed.`)
    } finally {
      setLoading(false)
    }
  }, [canAdmin, canTreasurer])

  useEffect(() => { void refresh() }, [refresh])

  async function call(name, args) {
    if (busy || !ready) return false
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data, error: rpcError } = await supabase.rpc(name, args)
      if (rpcError) throw rpcError
      if (!data?.id) throw new Error('The server did not confirm the change. Refresh before retrying.')
      setMessage('Recorded successfully. Verify the updated entry below.')
      await refresh()
      return true
    } catch (err) {
      setError(`${err.message || 'The operation failed'}. Refresh before retrying.`)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function createFund(event) {
    event.preventDefault()
    const name = fundName.trim()
    if (!canAdmin || name.length < 3 || name.length > 100) return
    if (await call('create_deposit_fund', { p_name: name })) setFundName('')
  }

  async function record(event) {
    event.preventDefault()
    const value = Number(form.amount)
    if (!canTreasurer || !funds.some(f => f.id === form.fund && f.active) ||
        !Number.isFinite(value) || value <= 0 || !/^\d+(\.\d{1,2})?$/.test(form.amount) ||
        form.bankReference.trim().length < 4 || form.depositDate > manilaToday()) return
    const saved = await call('record_bank_deposit', {
      p_fund_id: form.fund,
      p_deposit_date: form.depositDate,
      p_bank_reference: form.bankReference.trim(),
      p_amount: value,
    })
    if (saved) setForm(initial())
  }

  async function transition(row, action) {
    if (busy || !ready) return
    const configs = {
      clear: { name: 'clear_bank_deposit', label: 'Bank-statement evidence reference (5–200 characters)', key: 'p_bank_evidence' },
      reconcile: { name: 'reconcile_bank_deposit', label: 'Reconciliation note (5–500 characters)', key: 'p_note' },
      void: { name: 'void_pending_bank_deposit', label: 'Reason for voiding (5–500 characters)', key: 'p_reason' },
    }
    const cfg = configs[action]
    if (!cfg) return
    const entered = window.prompt(cfg.label)
    if (entered === null) return
    const text = entered.trim()
    if (text.length < 5 || text.length > (action === 'clear' ? 200 : 500)) {
      setError('Enter valid supporting evidence or a reason before continuing.')
      return
    }
    if (!window.confirm(`Confirm ${action} for deposit ${row.bank_reference} (${money(row.amount)})?`)) return
    await call(cfg.name, { p_deposit_id: row.id, [cfg.key]: text })
  }

  const fundLabel = id => funds.find(f => f.id === id)?.name || 'Fund on record'

  return (
    <main className="bank-deposits-page">
      <header><h1>Bank deposits</h1><p>Deposits are separate from homeowner receipts. Enter verified bank evidence; never infer deposits from collection totals.</p></header>
      <button type="button" onClick={() => void refresh()} disabled={loading || busy}>Refresh deposits</button>
      {loading && <p role="status">Loading deposit records…</p>}
      {error && <p className="bank-alert" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      {ready && canAdmin && <section className="bank-panel">
        <h2>Register deposit fund (Admin)</h2>
        <form onSubmit={createFund}>
          <label>Fund name<input required minLength={3} maxLength={100} value={fundName} onChange={e => setFundName(e.target.value)} /></label>
          <button disabled={busy || fundName.trim().length < 3}>Create fund</button>
        </form>
      </section>}

      {ready && canTreasurer && <section className="bank-panel">
        <h2>Record pending deposit (Treasurer)</h2>
        {funds.filter(f => f.active).length === 0 && <p>An Admin must register a fund before deposits can be recorded.</p>}
        <form onSubmit={record}>
          <label>Fund<select required value={form.fund} onChange={e => setForm({ ...form, fund: e.target.value })}>
            <option value="">Select active fund</option>
            {funds.filter(f => f.active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select></label>
          <label>Deposit date<input type="date" required max={manilaToday()} value={form.depositDate} onChange={e => setForm({ ...form, depositDate: e.target.value })} /></label>
          <label>Bank reference<input required minLength={4} maxLength={100} value={form.bankReference} onChange={e => setForm({ ...form, bankReference: e.target.value })} /></label>
          <label>Amount (PHP)<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></label>
          <button disabled={busy || funds.filter(f => f.active).length === 0}>Record pending deposit</button>
        </form>
      </section>}

      {ready && <section className="bank-panel">
        <h2>Recent deposit history</h2>
        <p>Showing the 200 most recently recorded deposits. This is not a complete export or bank reconciliation statement.</p>
        <div className="bank-scroll"><table><thead><tr><th>Date</th><th>Fund</th><th>Reference</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{deposits.length === 0 ? <tr><td colSpan="6">No deposits recorded.</td></tr> : deposits.map(row => <tr key={row.id}>
            <td>{row.deposit_date}</td><td>{fundLabel(row.fund_id)}</td><td>{row.bank_reference}</td>
            <td>{money(row.amount)}</td><td>{row.status}</td>
            <td>
              {canAdmin && row.status === 'pending' && <><button disabled={busy} type="button" onClick={() => transition(row, 'clear')}>Verify clearance</button>{' '}<button disabled={busy} type="button" onClick={() => transition(row, 'void')}>Void</button></>}
              {canTreasurer && row.status === 'cleared' && (
  <span title="Receipt matching must be implemented and verified before reconciliation.">
    Awaiting receipt matching
  </span>
)}
              {canTreasurer && (row.status === 'pending' || row.status === 'cleared') && <BankDepositReceiptMatcher deposit={row} />}
              {(role === 'secretary' || row.status === 'reconciled' || row.status === 'voided') && 'Read only'}
            </td>
          </tr>)}</tbody>
        </table></div>
      </section>}
    </main>
  )
}
