import { describe, expect, it } from 'vitest'
import { verifiedServiceStats } from './serviceStats'

const summary = { data: { service_count: 3, service_collected: '500.25' }, error: null }
const count = { count: 4, error: null }
const balances = { data: [{ id: 'a', balance_due: '125.50' }], error: null }

describe('verified service reporting', () => {
  it('keeps confirmed amounts and balances', () => {
    expect(verifiedServiceStats(summary, count, balances)).toEqual({
      stats: { monthCount: 3, monthCollected: 500.25, totalReceipts: 4 },
      balances: balances.data,
    })
  })
  it.each([
    [summary, { count: null }, balances],
    [{ data: null }, count, balances],
    [summary, count, { data: null }],
    [summary, count, { data: [{ balance_due: 'NaN' }] }],
    [{ error: { message: 'Offline' } }, count, balances],
  ])('rejects incomplete, invalid or failed reads', (a, b, c) => {
    expect(() => verifiedServiceStats(a, b, c)).toThrow()
  })
})
