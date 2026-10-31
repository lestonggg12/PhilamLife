import { ilikeAny, searchTokens } from './pagedQuery'

const COLUMNS = 'id, property_id, charge_type, amount, billing_month, description, created_by_name, created_at'
const SEARCH_COLUMNS = ['charge_type', 'description']
const OWNER_BATCH = 100
const RESULT_LIMIT = 50

// Partition the property ID range, not the results. The ranges are disjoint
// and cover every charge (including ones without a property), so exact counts
// can be added without double counting description/name matches.
export async function loadOpenCharges(client, properties, search) {
  const tokens = searchTokens(search)
  const ownerMatches = tokens.map((token) => properties
    .filter((property) => String(property.homeowner_name || '').toLowerCase().includes(token.toLowerCase()))
    .map((property) => Number(property.id)).filter(Number.isSafeInteger))
  const ids = [...new Set(ownerMatches.flat())].sort((a, b) => a - b)
  const boundaries = ids.filter((_, index) => index > 0 && index % OWNER_BATCH === 0)
  const ranges = [undefined, ...boundaries].map((from, index) => ({ from, to: boundaries[index] }))
  const results = []

  // Bound concurrency as well as URL size for very broad searches.
  for (let offset = 0; offset < ranges.length; offset += 4) {
    const group = await Promise.all(ranges.slice(offset, offset + 4).map(async ({ from, to }) => {
      let query = client.from('property_charges').select(COLUMNS, { count: 'exact' }).is('voided_at', null)
      if (from !== undefined) query = query.gte('property_id', from)
      if (to !== undefined) query = from === undefined
        ? query.or(`property_id.lt.${to},property_id.is.null`)
        : query.lt('property_id', to)
      tokens.forEach((token, index) => {
        const matches = ownerMatches[index].filter((id) => (from === undefined || id >= from) && (to === undefined || id < to))
        const parts = [ilikeAny(SEARCH_COLUMNS, token)]
        if (matches.length) parts.push(`property_id.in.(${matches.join(',')})`)
        query = query.or(parts.join(','))
      })
      return query.order('created_at', { ascending: false }).order('id', { ascending: true }).limit(RESULT_LIMIT)
    }))
    results.push(...group)
    const failed = group.find((result) => result.error)
    if (failed) return { data: [], count: 0, error: failed.error }
  }

  const data = results.flatMap((result) => result.data || []).sort((a, b) => {
    // Postgres DESC puts null dates first; ID resolves equal timestamps.
    const dateOrder = a.created_at == null ? (b.created_at == null ? 0 : -1)
      : b.created_at == null ? 1 : Date.parse(b.created_at) - Date.parse(a.created_at)
    return dateOrder || Number(a.id) - Number(b.id)
  }).slice(0, RESULT_LIMIT)
  return { data, count: results.reduce((total, result) => total + (result.count || 0), 0), error: null }
}
