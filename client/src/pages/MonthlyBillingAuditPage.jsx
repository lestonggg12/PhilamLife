import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { groupMonthlyBillingAudit, summarizeMonthlyBillingAudit } from '../lib/monthlyBillingAudit'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const monthNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' })
  .format(new Date()).replace(/^(\d{4})-(\d{2}).*/, '$1-$2')
const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '')

export default function MonthlyBillingAuditPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('month')
  const month = validMonth(requested) ? requested : monthNow()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState({ scope: '', loading: true, error: '', rows: [], report: null })

  useEffect(() => {
    let cancelled = false
    setData({ scope: month, loading: true, error: '', rows: [], report: null })
    async function load() {
      const charges = await fetchAll(() => supabase.from('property_charges')
        .select('id,property_id,amount,description,created_at,created_by_name,voided_at,properties!inner(homeowner_name,block,lot_number,property_classification)')
        .eq('charge_type', 'Association Dues').eq('billing_month', `${month}-01`)
        .order('property_id'))
      if (charges.error) throw charges.error
      const activity = await fetchAll(() => supabase.from('account_activity')
        .select('kind,payload').in('kind', ['credit_applied', 'monthly_balance_added'])
        .eq('payload->>billing_month', `${month}-01`))
      if (activity.error) throw activity.error
      const latest = await supabase.from('notifications')
        .select('kind,title,body,payload,created_at').eq('kind', 'collection_run')
        .order('created_at', { ascending: false }).limit(24)
      if (latest.error) throw latest.error
      const report = (latest.data || []).find(item => String(item.payload?.collection_date || '').slice(0, 7) === month) || null
      if (!cancelled) setData({ scope: month, loading: false, error: '',
        rows: groupMonthlyBillingAudit(charges.data || [], activity.data || []), report })
    }
    void load().catch(error => {
      if (!cancelled) setData({ scope: month, loading: false, error: error?.message || 'Billing audit unavailable.', rows: [], report: null })
    })
    return () => { cancelled = true }
  }, [month, revision])

  const ready = data.scope === month && !data.loading && !data.error
  const totals = useMemo(() => summarizeMonthlyBillingAudit(ready ? data.rows : []), [ready, data.rows])
  const rows = useMemo(() => (ready ? data.rows : []).filter(row => {
    if (filter === 'credit' && !(row.creditUsed > 0)) return false
    if (filter === 'unpaid' && !(row.unpaidAdded > 0)) return false
    if (filter === 'covered' && !row.fullyCovered) return false
    if (filter === 'unknown' && row.hasEvidence) return false
    const p = row.properties || {}
    return `${p.homeowner_name || ''} ${p.block || ''} ${p.lot_number || ''} ${row.property_id}`.toLowerCase().includes(search.toLowerCase().trim())
  }), [data.rows, ready, filter, search])

  return <div style={{ padding: '24px', maxWidth: 1250, margin: 'auto' }}>
    <header style={{ marginBottom: 20 }}>
      <h1>Monthly Billing Audit</h1>
      <p>Staff-only, read-only history for Admin, Secretary and Treasurer. Billing is not a cash receipt.</p>
      <label htmlFor="billing-month">Billing month </label>
      <input id="billing-month" type="month" value={month} onChange={e => {
        if (validMonth(e.target.value)) setParams({ month: e.target.value })
      }} />{' '}
      <button type="button" onClick={() => setRevision(value => value + 1)}>Refresh audit</button>
    </header>

    {data.loading || data.scope !== month ? <p role="status">Loading billing audit…</p> :
      data.error ? <p role="alert">Billing audit unavailable: {data.error}</p> : <>
        <section style={{ background: 'var(--surface, #f4f7fa)', borderRadius: 12, padding: 16, marginBottom: 20 }} aria-label="Monthly billing run status">
          {data.report?.payload?.snapshot_missing ? <p role="alert"><strong>Billing snapshot unavailable.</strong> The system could not verify the complete automatic run. Review individual charges and the billing job before relying on totals.</p>
            : data.report ? <><h2>{data.report.title}</h2><p>{data.report.body}</p><p>Summary recorded: {new Date(data.report.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila time).</p></>
              : <p><strong>No verified completion summary for this month.</strong> Billing may not have run yet, or its notification may have expired. Records below do not by themselves prove the scheduled run completed.</p>}
        </section>
        <section aria-label="Billing totals" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
          <div><strong>{totals.billed}</strong><div>Non-voided dues charges</div></div>
          <div><strong>{peso.format(totals.assessed)}</strong><div>Dues billed (not cash)</div></div>
          <div><strong>{peso.format(totals.verifiedCredit)}</strong><div>Verified advance credit used</div></div>
          <div><strong>{peso.format(totals.verifiedUnpaid)}</strong><div>Verified new unpaid portions</div></div>
          <div><strong>{totals.unknown}</strong><div>Charges without saved credit evidence</div></div>
        </section>
        <p>Verified credit and unpaid figures exclude older charges with no audit evidence; they are not estimated. Credit used here is not an additional payment.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <label>Filter <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All accounts</option><option value="credit">Credit used</option>
            <option value="unpaid">New unpaid amount</option><option value="covered">Fully covered by credit</option>
            <option value="unknown">Audit evidence unavailable</option>
          </select></label>
          <label>Search account <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, block, lot or ID" /></label>
        </div>
        <p>{rows.length} matching charges</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th scope="col">Account</th><th scope="col">Classification</th><th scope="col">Dues assessed</th><th scope="col">Credit used</th><th scope="col">New unpaid portion</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map(row => {
              const p = row.properties || {}
              return <tr key={row.id} style={{ borderTop: '1px solid #ccd6e0' }}>
                <td style={{ padding: 10 }}><Link to={`/homeowners/${row.property_id}`}>{p.homeowner_name || `Property ${row.property_id}`}</Link>
                  <div>Block {p.block || '—'}, Lot {p.lot_number ?? '—'}</div><small>Charge: {row.id}</small></td>
                <td>{String(p.property_classification || 'unclassified').replaceAll('_', ' ')}</td>
                <td>{peso.format(Number(row.amount))}</td>
                <td>{row.creditUsed == null ? 'Not recorded' : peso.format(row.creditUsed)}</td>
                <td>{row.unpaidAdded == null ? 'Not recorded' : peso.format(row.unpaidAdded)}</td>
                <td>{row.voided_at ? 'Voided' : row.hasEvidence ? row.fullyCovered ? 'Covered by credit' : row.unpaidAdded > 0 ? 'Unpaid portion added' : 'Recorded' : 'Historical evidence unavailable'}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
        {!rows.length && <p>No matching billing charges.</p>}
      </>}
  </div>
}
