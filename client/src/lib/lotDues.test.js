import { describe, expect, it, vi } from 'vitest'
import { hasRecurringDues, loadPostedMonthlyDues } from './lotDues'

describe('monthly association dues', () => {
  function mockChargeQuery(result) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    }
    return { from: vi.fn().mockReturnValue(query), query }
  }

  it('reads the adjusted active dues charge for the selected lot and Manila billing month', async () => {
    const client = mockChargeQuery({ data: { amount: '640.50' }, error: null })
    await expect(loadPostedMonthlyDues(client, 42, '2026-11')).resolves.toBe('640.50')
    expect(client.from).toHaveBeenCalledWith('property_effective_charges')
    expect(client.query.select).toHaveBeenCalledWith('amount')
    expect(client.query.eq.mock.calls).toEqual([
      ['property_id', 42],
      ['billing_month', '2026-11-01'],
      ['charge_type', 'Association Dues'],
    ])
  })

  it('distinguishes an unbilled month from an unavailable charge read', async () => {
    const failure = new Error('Charge read failed')
    await expect(loadPostedMonthlyDues(mockChargeQuery({ data: null }), 42, '2026-11')).resolves.toBeNull()
    await expect(loadPostedMonthlyDues(mockChargeQuery({ error: failure }), 42, '2026-11')).rejects.toBe(failure)
  })

  it('requires both the lot size and the rate to display recurring dues', () => {
    expect(hasRecurringDues({ lot_size_sqm: '100', price_per_sqm: '7', monthly_dues: '700' })).toBe(true)
    expect(hasRecurringDues({ lot_size_sqm: '100', price_per_sqm: null, monthly_dues: '0' })).toBe(false)
    expect(hasRecurringDues()).toBe(false)
  })
})
