import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { financialAuditDetails } from '../lib/financialAuditDetails'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

// Read-only. Credit consumption is shown as evidence, never as additional cash
// or as a second deduction from the account's balance.
export default function MonthlyChargeHistory({ propertyId, month, refreshKey }) {
  const [state, setState] = useState({ loading: true, error: '', rows: [] })
  useEffect(() => {
    if (!propertyId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) return undefined
    let cancelled = false
    setState({ loading: true, error: '', rows: [] })
    async function load() {
      const result = await fetchAll(() => supabase.from('property_charges')
        .select('id,amount,billing_month,charge_type,description,created_at,voided_at')
        .eq('property_id', propertyId).eq('billing_month', `${month}-01`)
        .eq('charge_type', 'Association Dues').order('created_at'))
      if (result.error) throw result.error
      const activity = await fetchAll(() => supabase.from('account_activity')
        .select('id,kind,payload')
        .eq('property_id', propertyId)
        .in('kind', ['credit_applied', 'monthly_balance_added'])
        .eq('payload->>billing_month', `${month}-01`)
        .order('occurred_at'))
      if (activity.error) throw activity.error
      if (cancelled) return
      const byCharge = new Map()
      for (const event of activity.data || []) {
        const id = event.payload?.source_id
        if (!id) continue
        const events = byCharge.get(String(id)) || []
        events.push(event)
        byCharge.set(String(id), events)
      }
      setState({ loading: false, error: '', rows: (result.data || []).map(charge => ({
        ...charge, events: byCharge.get(String(charge.id)) || [],
      })) })
    }
    load().catch(() => { if (!cancelled) setState({ loading: false, error: 'Monthly billing audit could not be loaded.', rows: [] }) })
    return () => { cancelled = true }
  }, [propertyId, month, refreshKey])
  return <section aria-label="Monthly system billing details" style={{ marginTop: 16 }}>
    <h3>Automatic monthly dues and credit use</h3>
    <p>Actual billed month, not necessarily the month a payment was received. Credit usage is not cash collected.</p>
    {state.loading ? <p>Loading monthly billing history…</p> : state.error ? <p role="alert">{state.error}</p>
      : !state.rows.length ? <p>No association dues charge is recorded for this billing month.</p>
        : <ul>{state.rows.map(charge => <li key={charge.id} style={{ marginBottom: 12 }}>
          <strong>{peso.format(Number(charge.amount))} dues assessed</strong>
          {charge.voided_at ? ' · Voided' : ' · Recorded'}
          <div>{charge.description || 'Automatic monthly association dues'}</div>
          <small>Charge reference: {charge.id}</small>
          {charge.events.length ? charge.events.map(event => <ul key={event.id}>
            {financialAuditDetails(event).filter(line => !line.startsWith('Monthly charge reference:')).map(line => <li key={line}>{line}</li>)}
          </ul>) : <p>Historic credit allocation evidence is not recorded for this charge; no credit amount is inferred.</p>}
        </li>)}</ul>}
  </section>
}
