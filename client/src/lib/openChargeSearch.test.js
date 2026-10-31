import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { loadOpenCharges } from './openChargeSearch'

// Evaluate the actual PostgREST URL produced by supabase-js, so the test
// checks query boundaries, multiple AND-ed OR filters, and the merged count.
function split(expression) {
  const parts = []; let start = 0; let depth = 0; let quote = false
  for (let i = 0; i < expression.length; i++) {
    const c = expression[i]
    if (c === '"') quote = !quote
    if (quote) continue
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1 }
  }
  return [...parts, expression.slice(start)]
}
function matches(row, filter) {
  const [, field, op, raw] = /^([\w_]+)\.(ilike|in|is|lt|gte)\.(.*)$/.exec(filter)
  if (op === 'is') return row[field] == null
  if (op === 'lt') return row[field] != null && row[field] < Number(raw)
  if (op === 'gte') return row[field] != null && row[field] >= Number(raw)
  if (op === 'in') return raw.slice(1, -1).split(',').map(Number).includes(row[field])
  return String(row[field] || '').toLowerCase().includes(raw.replace(/["%]/g, '').toLowerCase())
}
function fixture(rows, fail = false) {
  const requests = []
  const client = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: { fetch: async (url) => {
    const params = new URL(url).searchParams
    requests.push(params)
    if (fail) return new Response(JSON.stringify({ message: 'Test failure' }), { status: 500 })
    let data = rows.filter((row) => [...params].every(([key, value]) => {
      if (key === 'or') return split(value.slice(1, -1)).some((part) => matches(row, part))
      if (['voided_at', 'property_id'].includes(key)) return matches(row, `${key}.${value}`)
      return true
    }))
    const count = data.length
    data.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id - b.id)
    data = data.slice(0, Number(params.get('limit')))
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json', 'content-range': `0-${Math.max(0, data.length - 1)}/${count}` } })
  } } })
  return { client, requests }
}
const owners = Array.from({ length: 620 }, (_, i) => ({ id: i + 1, homeowner_name: 'Mock Homeowner' }))
const rows = owners.map((owner) => ({ id: owner.id, property_id: owner.id, charge_type: 'Assessment', description: owner.id % 2 ? 'Repair' : 'Mock repair', created_at: `2026-10-${String(owner.id % 28 + 1).padStart(2, '0')}T00:00:00Z`, voided_at: null }))

describe('open charge search without a homeowner cutoff', () => {
  it('finds charges beyond owner 500, with no duplicate counts from text matches', async () => {
    const { client, requests } = fixture(rows)
    const result = await loadOpenCharges(client, owners, 'Mock repair')
    expect(result.error).toBeNull()
    expect(result.count).toBe(620)
    expect(result.data).toHaveLength(50)
    const expected = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || a.id - b.id).slice(0, 50)
    expect(result.data.map((r) => r.id)).toEqual(expected.map((r) => r.id))
    expect(requests.length).toBe(7)
    expect(Math.max(...requests.map((p) => String(p).length))).toBeLessThan(4000)
  })
  it('includes text matches without a known owner and excludes voided charges', async () => {
    const extras = [
      { ...rows[0], id: 800, property_id: null, description: 'Mock repair' },
      { ...rows[0], id: 801, property_id: 99999, description: 'Mock repair' },
      { ...rows[0], id: 802, property_id: 1, voided_at: '2026-10-01' },
    ]
    const { client } = fixture([...rows, ...extras])
    expect((await loadOpenCharges(client, owners, 'Mock repair')).count).toBe(622)
  })
  it('keeps unsearched loading to one limited request', async () => {
    const { client, requests } = fixture(rows)
    const result = await loadOpenCharges(client, owners, '')
    expect(result.count).toBe(620)
    expect(result.data).toHaveLength(50)
    expect(requests).toHaveLength(1)
  })
  it('returns an error instead of a misleading partial result', async () => {
    const { client } = fixture(rows, true)
    expect((await loadOpenCharges(client, owners, 'Mock')).error.message).toBe('Test failure')
  })
})
