import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ilikeAny, searchTokens } from '../lib/pagedQuery'
import useDebouncedValue from '../hooks/useDebouncedValue'
import { transferChoices } from '../lib/homeownerTransfer'

export default function TransferHomeownerPicker({ previousProperty, selected, onSelect, disabled }) {
  const [search, setSearch] = useState('')
  const term = useDebouncedValue(search, 250)
  const [result, setResult] = useState({ choices: [], loading: true, error: '', more: false })
  useEffect(() => {
    let cancelled = false
    setResult({ choices: [], loading: true, error: '', more: false })
    async function load() {
      let query = supabase.from('properties')
        .select('id, homeowner_id, homeowner_name, block, lot_number, homeowner_status', { count: 'exact' })
        .eq('homeowner_status', 'active').not('homeowner_id', 'is', null)
        .neq('id', previousProperty.id)
        .order('homeowner_name').order('id').limit(30)
      if (previousProperty.homeowner_id) query = query.neq('homeowner_id', previousProperty.homeowner_id)
      for (const token of searchTokens(term)) {
        const filters = ilikeAny(['homeowner_name', 'block'], token)
        query = query.or(/^\d+$/.test(token) ? `${filters},lot_number.eq.${token}` : filters)
      }
      try {
        const { data, error, count } = await query
        if (!cancelled) setResult({ choices: transferChoices(data || [], previousProperty), loading: false,
          error: error ? 'Could not load homeowners. Try another search or reopen this form.' : '', more: count > 30 })
      } catch {
        if (!cancelled) setResult({ choices: [], loading: false, error: 'Could not load homeowners. Please reopen this form and try again.', more: false })
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
    <div className="transfer-owner-results" aria-label="Matching homeowners" aria-busy={result.loading}>
      {result.loading ? <p role="status">Loading homeowners…</p> : result.error ? <p role="alert">{result.error}</p> : !result.choices.length ? <p>No matching active homeowners.</p> : result.choices.map((person) =>
        <button type="button" key={person.homeowner_id} disabled={disabled} onClick={() => onSelect(person)}>
          <strong>{person.homeowner_name}</strong><small>{person.lots.join(' · ')}</small>
        </button>)}
    </div>
    {result.more && <small>Showing the first matching lots. Refine your search if the homeowner is missing.</small>}
  </div>
}
