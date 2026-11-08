import { describe, expect, it } from 'vitest'
import { accountActivityBounds, activityTimestamp, fetchAccountActivity } from './accountActivity'

function fixture(result) {
  const calls = []
  const chain = { then: (resolve) => Promise.resolve(result).then(resolve) }
  for (const method of ['select','eq','order','gte','lt','range']) chain[method] = (...args) => { calls.push([method, ...args]); return chain }
  return { calls, from: (table) => { calls.push(['from', table]); return chain } }
}
describe('account activity history', () => {
  it('scopes November to Manila month boundaries', () => {
    expect(accountActivityBounds({ month: '2026-11' })).toEqual({ from: '2026-11-01T00:00:00+08:00', to: '2026-12-01T00:00:00+08:00' })
  })
  it('rolls December into the next year', () => {
    expect(accountActivityBounds({ month: '2026-12' }).to).toBe('2027-01-01T00:00:00+08:00')
  })
  it('supports a whole tracker year and all-history view', () => {
    expect(accountActivityBounds({ year: 2026 })).toEqual({ from: '2026-01-01T00:00:00+08:00', to: '2027-01-01T00:00:00+08:00' })
    expect(accountActivityBounds()).toBeNull()
  })
  it('rejects invalid periods instead of silently showing another month', () => {
    for (const month of ['2026-13', '2026-1', 'bad']) expect(() => accountActivityBounds({ month })).toThrow()
    expect(() => accountActivityBounds({ year: 'bad' })).toThrow()
  })
  it('loads only the selected property and period, newest first', async () => {
    const db = fixture({ data: [{ id: 'event', body: '₱500.00 credit deducted' }], count: 25 })
    const result = await fetchAccountActivity(db, 12, { month: '2026-11' })
    expect(result).toEqual({ items: [{ id: 'event', body: '₱500.00 credit deducted' }], total: 25 })
    expect(db.calls).toContainEqual(['eq', 'property_id', 12])
    expect(db.calls).toContainEqual(['gte', 'occurred_at', '2026-11-01T00:00:00+08:00'])
    expect(db.calls).toContainEqual(['range', 0, 19])
    expect(db.calls).toContainEqual(['order', 'id', { ascending: false }])
  })
  it('can load older events without losing the account scope', async () => {
    const db = fixture({ data: [], count: 0 })
    await fetchAccountActivity(db, 12, { page: 2 })
    expect(db.calls).toContainEqual(['range', 40, 59])
    expect(db.calls).toContainEqual(['eq', 'property_id', 12])
  })
  it('does not fetch an unspecified account or an invalid page', async () => {
    const db = fixture({})
    await expect(fetchAccountActivity(db, null)).rejects.toThrow('Select a valid')
    await expect(fetchAccountActivity(db, 12, { page: -1 })).rejects.toThrow('Invalid activity page')
    expect(db.calls).toHaveLength(0)
  })
  it('propagates errors rather than displaying a false empty history', async () => {
    await expect(fetchAccountActivity(fixture({ error: new Error('offline') }), 1)).rejects.toThrow('offline')
  })
  it('uses Philippine time across midnight', () => {
    expect(activityTimestamp('2026-11-08T16:05:00Z')).toMatch(/Nov 9, 2026/)
    expect(activityTimestamp('bad')).toBe('Date unavailable')
  })
})
