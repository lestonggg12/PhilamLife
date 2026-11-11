import React, { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { groupMonthlyBillingAudit, summarizeMonthlyBillingAudit } from '../lib/monthlyBillingAudit'
import './MonthlyBillingAuditPage.css'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const monthNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit' }).format(new Date()).replace(/^(\d{4})-(\d{2}).*/, '$1-$2')
const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '')
const PER_PAGE = 25

export default function MonthlyBillingAuditPage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('month')
  const month = validMonth(requested) ? requested : monthNow()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
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

  useEffect(() => { setPage(1) }, [month, filter, search])
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
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const currentPage = Math.min(page, pages)
  const visibleRows = rows.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE)
  const stats = [
    ['Dues charges', totals.billed.toLocaleString('en-PH')],
    ['Total dues billed', peso.format(totals.assessed)],
    ['Verified credit used', peso.format(totals.verifiedCredit)],
    ['Verified unpaid portion', peso.format(totals.verifiedUnpaid)],
    ['Missing credit evidence', totals.unknown.toLocaleString('en-PH')],
  ]
  const statusFor = row => row.voided_at ? ['Voided', 'muted'] : row.hasEvidence ? row.fullyCovered ? ['Covered by credit', 'success'] : row.unpaidAdded > 0 ? ['Unpaid portion added', 'warning'] : ['Recorded', 'success'] : ['Historical evidence unavailable', 'muted']

  return <main className="billing-audit-page">
    <header className="billing-audit-header">
      <div>
        <div className="billing-audit-eyebrow">FINANCE / READ-ONLY REPORT</div>
        <h1>Monthly Billing Audit</h1>
        <p>Review monthly charges, verified credit deductions and outstanding portions. Billing is not a cash receipt.</p>
      </div>
      <div className="billing-audit-header-actions">
        <label htmlFor="billing-month">Billing month</label>
        <input id="billing-month" type="month" value={month} onChange={e => { if (validMonth(e.target.value)) setParams({ month: e.target.value }) }} />
        <button className="billing-audit-refresh" type="button" disabled={data.loading} onClick={() => setRevision(value => value + 1)}>↻ Refresh audit</button>
      </div>
    </header>

    {data.loading || data.scope !== month ? <div className="billing-audit-panel" role="status">Loading billing audit…</div> :
      data.error ? <div className="billing-audit-notice billing-audit-notice-error" role="alert">Billing audit unavailable: {data.error}</div> : <>
        <section className="billing-audit-notice" aria-label="Monthly billing run status">
          {data.report?.payload?.snapshot_missing ? <p role="alert"><strong>Billing snapshot unavailable.</strong> The complete automatic run could not be verified. Review the charges and scheduled job before relying on totals.</p>
            : data.report ? <><strong>{data.report.title}</strong><p>{data.report.body}</p><small>Summary recorded: {new Date(data.report.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Manila time)</small></>
              : <p><strong>No verified completion summary for this month.</strong> Billing may not have run yet, or the completion notification may have expired. Charges alone do not prove the scheduled run completed.</p>}
        </section>
        <section className="billing-audit-stats" aria-label="Billing totals">
          {stats.map(([label, value]) => <div className="billing-audit-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </section>
        <p className="billing-audit-explainer">Credit and unpaid amounts reflect saved audit evidence only. Historical values are never estimated, and credit used is not additional cash received.</p>
        <section className="billing-audit-panel" aria-label="Billing charge records">
          <div className="billing-audit-toolbar">
            <div><h2>Billing records</h2><p>{rows.length.toLocaleString('en-PH')} matching charges</p></div>
            <div className="billing-audit-controls">
              <label htmlFor="billing-filter">Status filter<select id="billing-filter" value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="all">All accounts</option><option value="credit">Credit used</option><option value="unpaid">New unpaid amount</option><option value="covered">Fully covered by credit</option><option value="unknown">Audit evidence unavailable</option>
              </select></label>
              <label htmlFor="billing-search">Search account<input id="billing-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, block, lot or ID" /></label>
            </div>
          </div>
          <div className="billing-audit-table-scroll" role="region" aria-label="Billing records table" tabIndex={0}>
            <table className="billing-audit-table"><thead><tr><th scope="col">Account</th><th scope="col">Classification</th><th scope="col">Dues assessed</th><th scope="col">Credit used</th><th scope="col">New unpaid</th><th scope="col">Status</th></tr></thead>
              <tbody>{visibleRows.map(row => {
                const p = row.properties || {}
                const [status, type] = statusFor(row)
                return <tr key={row.id}>
                  <td><Link className="billing-audit-account" to={`/homeowners/${row.property_id}`}>{p.homeowner_name || `Property ${row.property_id}`}</Link><span className="billing-audit-secondary">Block {p.block || '—'} · Lot {p.lot_number ?? '—'}</span><span className="billing-audit-charge" title={String(row.id)}>Charge #{String(row.id).slice(0, 8)}</span></td>
                  <td className="billing-audit-classification">{String(p.property_classification || 'unclassified').replaceAll('_', ' ')}</td>
                  <td className="billing-audit-money">{peso.format(Number(row.amount))}</td>
                  <td className="billing-audit-money">{row.creditUsed == null ? <span className="billing-audit-unrecorded">Not recorded</span> : peso.format(row.creditUsed)}</td>
                  <td className="billing-audit-money">{row.unpaidAdded == null ? <span className="billing-audit-unrecorded">Not recorded</span> : peso.format(row.unpaidAdded)}</td>
                  <td><span className={`billing-audit-status billing-audit-status-${type}`}>{status}</span></td>
                </tr>
              })}</tbody>
            </table>
            {!rows.length && <p className="billing-audit-empty">No matching billing charges.</p>}
          </div>
          {rows.length > 0 && <nav className="billing-audit-pager" aria-label="Billing records pagination">
            <span>Showing {(currentPage - 1) * PER_PAGE + 1}–{Math.min(currentPage * PER_PAGE, rows.length)} of {rows.length}</span>
            <div><button type="button" disabled={currentPage === 1} onClick={() => setPage(1)}>First</button><button type="button" disabled={currentPage === 1} onClick={() => setPage(n => Math.max(1, n - 1))}>Previous</button><span>Page {currentPage} of {pages}</span><button type="button" disabled={currentPage === pages} onClick={() => setPage(n => Math.min(pages, n + 1))}>Next</button><button type="button" disabled={currentPage === pages} onClick={() => setPage(pages)}>Last</button></div>
          </nav>}
        </section>
      </>}
  </main>
}
