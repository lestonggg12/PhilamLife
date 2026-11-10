import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const monthLabel = (date) => new Intl.DateTimeFormat('en-PH', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`))

export default function CctvElectricityCompensation({ canEdit }) {
  const [properties, setProperties] = useState([])
  const [schedules, setSchedules] = useState([])
  const [propertyId, setPropertyId] = useState('')
  const [amount, setAmount] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [reason, setReason] = useState('Electricity supplied to subdivision CCTV')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const saving = useRef(false)

  async function refresh() {
    const [lots, policies] = await Promise.all([
      fetchAll(() => supabase.from('properties').select('id,block,lot_number,homeowner_name,homeowner_status')),
      fetchAll(() => supabase.from('cctv_electricity_schedules').select('id,property_id,monthly_credit,starts_on,ends_before,reason,created_at')),
    ])
    if (lots.error) throw lots.error
    if (policies.error) throw policies.error
    setProperties((lots.data || []).filter((p) => p.homeowner_status === 'active')
      .sort((a, b) => `${a.block} ${a.lot_number}`.localeCompare(`${b.block} ${b.lot_number}`)))
    setSchedules((policies.data || []).sort((a, b) => b.starts_on.localeCompare(a.starts_on)))
  }

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const [lots, policies] = await Promise.all([
          fetchAll(() => supabase.from('properties').select('id,block,lot_number,homeowner_name,homeowner_status')),
          fetchAll(() => supabase.from('cctv_electricity_schedules').select('id,property_id,monthly_credit,starts_on,ends_before,reason,created_at')),
        ])
        if (!mounted) return
        if (lots.error) throw lots.error
        if (policies.error) throw policies.error
        setProperties((lots.data || []).filter((p) => p.homeowner_status === 'active')
          .sort((a, b) => `${a.block} ${a.lot_number}`.localeCompare(`${b.block} ${b.lot_number}`)))
        setSchedules((policies.data || []).sort((a, b) => b.starts_on.localeCompare(a.starts_on)))
      } catch (error) {
        if (mounted) setMessage(`Unable to load CCTV schedules: ${error.message}`)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  async function save(event) {
    event.preventDefault()
    if (saving.current || !canEdit) return
    const n = Number(amount)
    if (!propertyId || !/^\d+(?:\.\d{1,2})?$/.test(amount) || n <= 0 ||
        n > 100000 || !/^\d{4}-\d{2}$/.test(startMonth) ||
        (endMonth && (!/^\d{4}-\d{2}$/.test(endMonth) || endMonth < startMonth)) ||
        reason.trim().length < 5) {
      setMessage('Select a homeowner, valid monthly credit, starting month and reason.')
      return
    }
    saving.current = true
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.rpc('create_cctv_electricity_schedule', {
        p_property_id: Number(propertyId),
        p_monthly_credit: n,
        p_start_month: `${startMonth}-01`,
        p_end_month: endMonth ? `${endMonth}-01` : null,
        p_reason: reason.trim(),
      })
      if (error) throw error
      await refresh()
      setMessage('CCTV compensation saved. Eligible existing bills have been credited; future bills will be credited automatically.')
      setAmount('')
      setStartMonth('')
      setEndMonth('')
    } catch (error) {
      setMessage(`CCTV compensation was not confirmed: ${error.message}`)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const selected = properties.find((p) => String(p.id) === String(propertyId))
  return <div style={{ display: 'grid', gap: 14, width: '100%' }}>
    <p className="ss-info">This is a non-cash credit applied against each eligible month's association dues, even when the homeowner pays partially or not at all. Backdated months apply to existing bills. Receipts are not modified.</p>
    <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <label className="ss-field"><span>Homeowner / lot</span>
        <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!canEdit || busy} required>
          <option value="">Select an active homeowner</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.block}, Lot {p.lot_number} — {p.homeowner_name || 'No name'}</option>)}
        </select>
      </label>
      {selected && <small>{selected.block}, Lot {selected.lot_number}</small>}
      <label className="ss-field"><span>Monthly electricity credit (₱)</span>
        <input type="number" min="0.01" max="100000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canEdit || busy} required placeholder="150.00" />
      </label>
      <label className="ss-field"><span>Effective starting month (past months allowed)</span>
        <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} disabled={!canEdit || busy} required />
      </label>
      <label className="ss-field"><span>Last eligible month (optional)</span>
        <input type="month" value={endMonth} min={startMonth || undefined} onChange={(e) => setEndMonth(e.target.value)} disabled={!canEdit || busy} />
      </label>
      <label className="ss-field"><span>Approval / CCTV electricity explanation</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canEdit || busy} minLength={5} maxLength={250} required />
      </label>
      {message && <p role="status" className="ss-info">{message}</p>}
      <button type="submit" className="ss-primary" disabled={!canEdit || busy}>{busy ? 'Applying credits…' : 'Approve monthly CCTV credit'}</button>
    </form>
    <h3>Approved schedules</h3>
    {schedules.length === 0 ? <p className="ss-info">No CCTV compensation schedules yet.</p> :
      <div style={{ display: 'grid', gap: 9 }}>
        {schedules.map((s) => {
          const p = properties.find((x) => x.id === s.property_id)
          return <div key={s.id} style={{ border: '1px solid var(--border-color, #ccc)', padding: 12, borderRadius: 8 }}>
            <strong>{p ? `${p.block}, Lot ${p.lot_number} — ${p.homeowner_name || ''}` : `Property ${s.property_id}`}</strong>
            <div>{money.format(Number(s.monthly_credit))} monthly · {monthLabel(s.starts_on)} – {s.ends_before ? monthLabel(new Date(Date.parse(`${s.ends_before}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)) : 'ongoing'}</div>
            <small>{s.reason}</small>
          </div>
        })}
      </div>}
    <p className="ss-info">Existing schedules are immutable for audit safety. To change a rate, create a new non-overlapping period; overlapping periods are rejected.</p>
  </div>
}
