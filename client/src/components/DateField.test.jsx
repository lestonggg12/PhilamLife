import { describe, expect, it } from 'vitest'
import { isMonthDisabled, todayMonthKey } from './DateField'

describe('Archive month boundaries', () => {
  it.each(['2026-11', '2026-11-02'])('allows the current maximum month for %s', (max) => {
    expect(isMonthDisabled('2026-11', undefined, max)).toBe(false)
    expect(isMonthDisabled('2026-12', undefined, max)).toBe(true)
    expect(isMonthDisabled('2026-10', undefined, max)).toBe(false)
  })
  it('uses the actual today year and month independently of the viewed year', () => {
    expect(todayMonthKey('2026-11-02')).toBe('2026-11')
  })
  it('handles minimum bounds and year transitions', () => {
    expect(isMonthDisabled('2025-12', '2026-01-15', '2026-11')).toBe(true)
    expect(isMonthDisabled('2026-01', '2026-01-15', '2026-11')).toBe(false)
    expect(isMonthDisabled('2026-12', undefined, '2027-01')).toBe(false)
    expect(isMonthDisabled('2027-02', undefined, '2027-01')).toBe(true)
  })
})
