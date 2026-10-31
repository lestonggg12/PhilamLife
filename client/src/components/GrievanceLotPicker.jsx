import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { applySearch } from '../lib/pagedQuery'
import useDebouncedValue from '../hooks/useDebouncedValue'

export default function GrievanceLotPicker({ value, label, onChange }) {
  const [search, setSearch] = useState(label || '')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const term = useDebouncedValue(search, 300)
  useEffect(() => {
    if (!open || term.trim().length < 2) { setRows([]); return undefined }
    let cancelled = false
    setLoading(true); setError('')
    async function load() {
      const query = supabase.from('properties').select('id,homeowner_name,block,lot_number').eq('homeowner_status', 'active')
      const { data, error: failure } = await applySearch(query, ['homeowner_name','block'], term).order('homeowner_name').order('id').limit(20)
      if (!cancelled) { setRows(data || []); setError(failure ? 'Lots could not be loaded. Try again.' : ''); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [open, term])
  return <div className="grievance-lot-picker">
    <input aria-label="Find an affected lot" value={search} placeholder="Search homeowner or block (optional)" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onChange={(e) => { setSearch(e.target.value); setOpen(true); if (value) onChange(null) }} role="combobox" aria-expanded={open} aria-controls="grievance-lot-options" />
    {value && <button type="button" className="grievance-text-button" onClick={() => { setSearch(''); onChange(null); setOpen(false) }}>Clear linked lot</button>}
    {open && <div id="grievance-lot-options" role="listbox" className="grievance-lot-options">
      {error || (loading ? 'Loading lots...' : term.trim().length < 2 ? 'Type at least two characters.' : !rows.length ? 'No matching lots.' : '')}
      {!loading && rows.map((lot) => <button type="button" role="option" aria-selected={String(lot.id) === String(value)} key={lot.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setSearch(`${lot.homeowner_name} — ${lot.block}, Lot ${lot.lot_number}`); setOpen(false); onChange(lot) }}>{lot.homeowner_name} — {lot.block}, Lot {lot.lot_number}</button>)}
      {rows.length === 20 && <small>Showing up to 20 lots. Refine your search to find another.</small>}
    </div>}
  </div>
}
