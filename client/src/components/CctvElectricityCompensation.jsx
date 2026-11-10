import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import DateField from './DateField'
import './CctvElectricityCompensation.css'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const monthLabel = (date) => new Intl.DateTimeFormat('en-PH', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${date}T12:00:00Z`))

export default function CctvElectricityCompensation({ canEdit, fixedPropertyId = null, onChanged }) {
  const [properties, setProperties] = useState([])
  const [schedules, setSchedules] = useState([])
  const [propertyId, setPropertyId] = useState(fixedPropertyId == null ? '' : String(fixedPropertyId))
  const [amount, setAmount] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [reason, setReason] = useState('Electricity supplied to subdivision CCTV')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const saving = useRef(false)

  useEffect(() => {
    if (fixedPropertyId != null) setPropertyId(String(fixedPropertyId))
  }, [fixedPropertyId])

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
    if (!(fixedPropertyId ?? propertyId) || !/^\d+(?:\.\d{1,2})?$/.test(amount) || n <= 0 ||
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
        p_property_id: Number(fixedPropertyId ?? propertyId),
        p_monthly_credit: n,
        p_start_month: `${startMonth}-01`,
        p_end_month: endMonth ? `${endMonth}-01` : null,
        p_reason: reason.trim(),
      })
      if (error) throw error
      await refresh()
      onChanged?.()
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

  const selected = properties.find((p) => String(p.id) === String(fixedPropertyId ?? propertyId))
  const visibleSchedules = fixedPropertyId == null ? schedules : schedules.filter((s) => String(s.property_id) === String(fixedPropertyId))
  const validDraft = Boolean((fixedPropertyId ?? propertyId) && Number(amount) > 0 && startMonth && reason.trim().length >= 5 && (!endMonth || endMonth >= startMonth))
  const errorMessage = /unable|not confirmed|valid monthly/i.test(message)

  return <section className="cctv-card" aria-labelledby="cctv-title">
    <header className="cctv-card-heading">
      <div className="cctv-icon" aria-hidden="true">⚡</div>
      <div className="cctv-heading-copy">
        <span className="cctv-eyebrow">PROPERTY BILLING BENEFIT</span>
        <h3 id="cctv-title">CCTV electricity compensation</h3>
        <p>Monthly dues credit for electricity supplied to village CCTV cameras.</p>
      </div>
      <span className="cctv-chip">Non-cash credit</span>
    </header>
    <div className="cctv-card-body">
      <p className="cctv-hint"><strong>How it works:</strong> Credits apply to eligible monthly dues even when a homeowner pays partially or has not paid. Backdated months apply to existing bills. Receipts are not changed.</p>
      <div className="cctv-subheading"><h4>Approve monthly credit</h4><p>Set the approved amount and the months it covers.</p></div>
      <form className="cctv-form" onSubmit={save}>
        {fixedPropertyId == null && <label className="cctv-field cctv-full"><span>Homeowner / property</span>
          <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={!canEdit || busy} required>
            <option value="">Select an active homeowner</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.block}, Lot {p.lot_number} — {p.homeowner_name || 'No name'}</option>)}
          </select>
        </label>}
        {selected && <div className="cctv-selected cctv-full">For <strong>{selected.block}, Lot {selected.lot_number}</strong></div>}
        <label className="cctv-field"><span>Monthly credit (₱) <b>*</b></span>
          <input type="number" min="0.01" max="100000" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!canEdit || busy} required placeholder="150.00" />
          <small>Deducted from eligible monthly dues</small>
        </label>
        <div className="cctv-field"><span>Starting month <b>*</b></span>
          <DateField monthOnly value={startMonth} onChange={setStartMonth} disabled={!canEdit || busy}
            ariaLabel="CCTV compensation starting month" placeholder="Select starting month" required clearable={false} />
          <small>Earlier months may be selected for retroactive compensation</small>
        </div>
        <div className="cctv-field"><span>Ending month <em>Optional</em></span>
          <DateField monthOnly value={endMonth} min={startMonth || undefined} onChange={setEndMonth}
            disabled={!canEdit || busy} ariaLabel="CCTV compensation ending month" placeholder="No end date (ongoing)" />
          {endMonth && <button type="button" className="cctv-clear-month" onClick={() => setEndMonth('')}
            disabled={!canEdit || busy}>Remove ending month — make ongoing</button>}
          <small>Leave blank to apply every eligible month indefinitely</small>
        </div>
        <label className="cctv-field cctv-full"><span>Approval / electricity arrangement <b>*</b></span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canEdit || busy} minLength={5} maxLength={250} required />
        </label>
        <div className="cctv-footer cctv-full">
          <div className="cctv-summary">{validDraft ? <><strong>{money.format(Number(amount))} / month</strong><span>{monthLabel(`${startMonth}-01`)} – {endMonth ? monthLabel(`${endMonth}-01`) : 'Ongoing'}</span></> : <span>Complete the fields to approve a credit.</span>}</div>
          <button type="submit" className="cctv-approve" disabled={!canEdit || busy || !validDraft}>{busy ? 'Applying credits…' : 'Approve CCTV credit'}</button>
        </div>
        {message && <p role="status" className={`cctv-message cctv-full ${errorMessage ? 'cctv-error' : 'cctv-success'}`}>{message}</p>}
      </form>
      <div className="cctv-subheading cctv-schedule-heading"><div><h4>Approved schedules</h4><p>Recorded arrangements for this property</p></div><span className="cctv-counter">{visibleSchedules.length}</span></div>
      {visibleSchedules.length === 0 ? <div className="cctv-empty">No approved compensation schedules yet.</div> :
        <div className="cctv-schedules">{visibleSchedules.map((s) => {
          const p = properties.find((x) => x.id === s.property_id)
          const finalMonth = s.ends_before ? monthLabel(new Date(Date.parse(`${s.ends_before}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)) : 'Ongoing'
          return <article className="cctv-schedule" key={s.id}>
            <div><strong>{money.format(Number(s.monthly_credit))} <span>/ month</span></strong><p>{monthLabel(s.starts_on)} – {finalMonth}</p>
              {fixedPropertyId == null && <small>{p ? `${p.block}, Lot ${p.lot_number} — ${p.homeowner_name || ''}` : `Property ${s.property_id}`}</small>}
              <small>{s.reason}</small></div><span className="cctv-approved">Approved</span>
          </article>
        })}</div>}
      <p className="cctv-audit">Schedules are immutable for audit safety. New rates require non-overlapping periods.</p>
    </div>
  </section>
}
