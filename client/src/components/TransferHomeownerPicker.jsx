import React, { useEffect, useState } from 'react'
import Skeleton from './skeleton/Skeleton'
import { supabase } from '../lib/supabaseClient'
import { contactSearchFilters } from '../lib/contactManager'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { transferChoices } from '../lib/homeownerTransfer'

export default function TransferHomeownerPicker({ previousProperty, selected, onSelect, disabled }) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search.trim(), 250)
  const [result, setResult] = useState(null)
  const loading = search.trim() !== term || result?.term !== term
  useEffect(() => {
    let cancelled = false
    async function load() {
      let query = supabase.from('properties')
        .select('id, homeowner_id, homeowner_name, block, lot_number, homeowner_status', { count: 'exact' })
        .eq('homeowner_status', 'active').not('homeowner_id', 'is', null)
        .neq('id', previousProperty.id)
        .order('homeowner_name').order('id').limit(30)
      if (previousProperty.homeowner_id) query = query.neq('homeowner_id', previousProperty.homeowner_id)
      for (const filter of contactSearchFilters(term, ['homeowner_name', 'block'])) query = query.or(filter)
      try {
        const { data, error, count } = await query
        if (!cancelled) setResult({ term, choices: transferChoices(data || [], previousProperty),
          error: error ? 'Could not load homeowners. Try another search or reopen this form.' : '', more: count > 30 })
      } catch {
        if (!cancelled) setResult({ term, choices: [], error: 'Could not load homeowners. Please reopen this form and try again.', more: false })
      }
    }
    load()
    return () => { cancelled = true }
  }, [previousProperty.id, previousProperty.homeowner_id, term])
  if (selected) return <div className="transfer-selected-owner">
    <div><strong>{selected.homeowner_name}</strong><small>{selected.lots.join(' · ')}</small></div>
    <button type="button" disabled={disabled} onClick={() => onSelect(null)}>Change</button>
  </div>
  return <div className="transfer-owner-picker">
    <label htmlFor="transfer-owner-search">Find the existing homeowner</label>
    <input id="transfer-owner-search" value={search} disabled={disabled} placeholder="Search name, block or lot" onChange={(event) => setSearch(event.target.value)} />
    <div className="transfer-owner-results" aria-label="Matching homeowners" aria-busy={loading}>
      {loading ? <div className="transfer-owner-skeleton" aria-busy="true"><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><Skeleton variant="rect" width="100%" height="42px" /><span className="skeleton-region-status" role="status">Loading</span></div> : result.error ? <p role="alert">{result.error}</p> : !result.choices.length ? <p>No matching active homeowners.</p> : result.choices.map((person) =>
        <button type="button" key={person.homeowner_id} disabled={disabled} onClick={() => onSelect(person)}>
          <strong>{person.homeowner_name}</strong><small>{person.lots.join(' · ')}</small>
        </button>)}
    </div>
    {!loading && result.more && <small>Showing the first matching lots. Refine your search if the homeowner is missing.</small>}
  </div>
}
