import { describe, expect, it } from 'vitest'
import { requireHomeownerSnapshot } from './homeownerDirectorySnapshot'
const good = [
  { data: [{ property_id: 1, monthly_dues: 30 }], error: null },
  { data: [{ id: 1, current_balance: 120 }], error: null },
  { data: [{ property_id: 1, active_payment_count: 2 }], error: null },
]
describe('homeowner directory financial snapshot', () => {
  it('returns all three verified sources together', () => {
    expect(requireHomeownerSnapshot(...good)).toMatchObject({
      properties: good[1].data, payments: good[2].data, dues: good[0].data,
    })
  })
  it('rejects partial query errors instead of accepting empty replacements', () => {
    const error = { message: 'Network failed' }
    expect(() => requireHomeownerSnapshot(good[0], { data: null, error }, good[2])).toThrow()
  })
  it.each([null, [], {}])('rejects incomplete source payload %j', (invalid) => {
    expect(() => requireHomeownerSnapshot(good[0], { data: invalid }, good[2])).toThrow('incomplete')
  })
  it.each([null, 'not a number', Infinity])('rejects missing/invalid balances %j', (balance) => {
    expect(() => requireHomeownerSnapshot(good[0], { data: [{ current_balance: balance }] }, good[2])).toThrow('balance')
  })
  it.each([null, -1, 1.2, 'wrong'])('rejects missing/invalid receipt counts %j', (count) => {
    expect(() => requireHomeownerSnapshot(good[0], good[1], { data: [{ active_payment_count: count }] })).toThrow('count')
  })
  it('accepts valid zero counts and zero balances', () => {
    expect(() => requireHomeownerSnapshot(good[0], { data: [{ current_balance: 0 }] }, { data: [{ active_payment_count: 0 }] })).not.toThrow()
  })
})
