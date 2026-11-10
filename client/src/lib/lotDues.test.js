import { describe, expect, it } from 'vitest'
import { hasRecurringDues } from './lotDues'

describe('monthly association dues', () => {
  it('requires both the lot size and the rate to display recurring dues', () => {
    expect(hasRecurringDues({ lot_size_sqm: '100', price_per_sqm: '7', monthly_dues: '700' })).toBe(true)
    expect(hasRecurringDues({ lot_size_sqm: '100', price_per_sqm: null, monthly_dues: '0' })).toBe(false)
    expect(hasRecurringDues()).toBe(false)
  })
})
