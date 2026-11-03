import { describe, expect, it, vi } from 'vitest'
import { readPropertyBalance } from './paymentBalanceRefresh'

const fake = (data, error = null) => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data, error }) })),
    })),
  })),
})

describe('authoritative payment balance refresh', () => {
  it('preserves negative advance credit', async () => {
    await expect(readPropertyBalance(fake({ id: 10, current_balance: '-125.25' }), 10))
      .resolves.toBe(-125.25)
  })
  it('preserves an actual zero balance', async () => {
    await expect(readPropertyBalance(fake({ id: 10, current_balance: '0.00' }), 10))
      .resolves.toBe(0)
  })
  it('never silently replaces a missing account with zero', async () => {
    await expect(readPropertyBalance(fake(null), 10)).rejects.toThrow('unavailable')
    await expect(readPropertyBalance(fake({ current_balance: null }), 10)).rejects.toThrow('unavailable')
  })
  it('propagates permission and network errors', async () => {
    await expect(readPropertyBalance(fake(null, new Error('Access denied')), 10))
      .rejects.toThrow('Access denied')
  })
})
