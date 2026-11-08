export const ACCOUNT_ACTIVITY_PAGE_SIZE = 20

// Calendar boundaries only; monetary values are never calculated in this helper.
export function accountActivityBounds({ month, year } = {}) {
  if (month) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
    if (!match) throw new Error('Invalid activity month.')
    const y = Number(match[1]), m = Number(match[2])
    return {
      from: `${match[1]}-${match[2]}-01T00:00:00+08:00`,
      to: `${String(m === 12 ? y + 1 : y).padStart(4, '0')}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+08:00`,
    }
  }
  if (year != null) {
    if (!Number.isInteger(Number(year)) || Number(year) < 1 || Number(year) > 9998) throw new Error('Invalid activity year.')
    return { from: `${String(year).padStart(4, '0')}-01-01T00:00:00+08:00`, to: `${String(Number(year) + 1).padStart(4, '0')}-01-01T00:00:00+08:00` }
  }
  return null
}

export async function fetchAccountActivity(db, propertyId, { month, year, page = 0 } = {}) {
  if (!/^[1-9]\d*$/.test(String(propertyId))) throw new Error('Select a valid property account.')
  if (!Number.isInteger(page) || page < 0) throw new Error('Invalid activity page.')
  const bounds = accountActivityBounds({ month, year })
  let query = db.from('account_activity')
    .select('id,property_id,kind,title,body,payload,occurred_at', { count: 'exact' })
    .eq('property_id', propertyId)
    .order('occurred_at', { ascending: false }).order('id', { ascending: false })
  if (bounds) query = query.gte('occurred_at', bounds.from).lt('occurred_at', bounds.to)
  const { data, count, error } = await query.range(page * ACCOUNT_ACTIVITY_PAGE_SIZE, (page + 1) * ACCOUNT_ACTIVITY_PAGE_SIZE - 1)
  if (error) throw error
  return { items: data || [], total: count || 0 }
}

export function activityTimestamp(value) {
  if (!Number.isFinite(Date.parse(value))) return 'Date unavailable'
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value))
}
