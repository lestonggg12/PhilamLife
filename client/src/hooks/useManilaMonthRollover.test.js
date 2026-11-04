
import { describe, expect, it } from 'vitest'
import { manilaMonth } from './useManilaMonthRollover'

describe('Philippine calendar rollover', () => {
  it('switches from December 2026 to January 2027 at midnight Manila time', () => {
    expect(manilaMonth(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12')
    expect(manilaMonth(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01')
  })

  it('handles the next month and year without changing stored records', () => {
    expect(manilaMonth(new Date('2027-01-31T16:00:00Z'))).toBe('2027-02')
  })
})
