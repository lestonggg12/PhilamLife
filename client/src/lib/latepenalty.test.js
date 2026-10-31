import { describe, expect, it } from 'vitest'
import {
  fractionToPercent,
  hasBreakdown,
  parseWholeNumber,
  penaltyLabel,
  percentToFraction,
} from './latepenalty'

describe('percentToFraction', () => {
  it('converts a percent to the stored fraction', () => {
    expect(percentToFraction('1.5')).toEqual({ value: '0.0150' })
    expect(percentToFraction('2')).toEqual({ value: '0.0200' })
    expect(percentToFraction('0')).toEqual({ value: '0.0000' })
    expect(percentToFraction('0.29')).toEqual({ value: '0.0029' })
    expect(percentToFraction('100')).toEqual({ value: '1.0000' })
  })

  it('rejects blank, negative, non-numeric, too precise and over 100', () => {
    expect(percentToFraction('').error).toMatch(/required/)
    expect(percentToFraction('-1').error).toMatch(/negative/)
    expect(percentToFraction('abc').error).toMatch(/2 decimal/)
    expect(percentToFraction('1.555').error).toMatch(/2 decimal/)
    expect(percentToFraction('100.5').error).toMatch(/2 decimal|more than 100/)
    expect(percentToFraction('101').error).toMatch(/more than 100/)
  })
})

describe('fractionToPercent', () => {
  it('turns the stored fraction back into a clean percent', () => {
    expect(fractionToPercent('0.0150')).toBe('1.5')
    expect(fractionToPercent(0.025)).toBe('2.5')
    expect(fractionToPercent(0)).toBe('0')
    expect(fractionToPercent(null)).toBe('')
  })
})

describe('parseWholeNumber', () => {
  it('accepts whole numbers in range and rejects the rest', () => {
    expect(parseWholeNumber('12', 'Months', 1, 600)).toEqual({ value: 12 })
    expect(parseWholeNumber('0', 'Months', 1, 600).error).toMatch(/between/)
    expect(parseWholeNumber('1.5', 'Months', 1, 600).error).toMatch(/whole/)
    expect(parseWholeNumber('', 'Months', 1, 600).error).toMatch(/required/)
  })
})

describe('penaltyLabel', () => {
  const base = { penalties_count: 6, penalties_rated_count: 6, rate_min: 0.015, rate_max: 0.015, penalties_outstanding: 7200, penalties_posted_total: 7200 }

  it('shows count x rate when every penalty used the same rate', () => {
    expect(penaltyLabel(base)).toBe('Late penalties (6 × 1.5%)')
  })

  it('falls back to the count when rates differ or some penalties were paid', () => {
    expect(penaltyLabel({ ...base, rate_max: 0.025 })).toBe('Late penalties (6)')
    expect(penaltyLabel({ ...base, penalties_outstanding: 6000 })).toBe('Late penalties (6)')
    expect(penaltyLabel({ ...base, penalties_rated_count: 5 })).toBe('Late penalties (6)')
  })

  it('is empty with no penalties', () => {
    expect(penaltyLabel({ penalties_count: 0 })).toBe('')
    expect(penaltyLabel(null)).toBe('')
  })
})

describe('hasBreakdown', () => {
  it('is true only with an entered balance or penalties', () => {
    expect(hasBreakdown({ entered_balance: 80000, penalties_count: 0 })).toBe(true)
    expect(hasBreakdown({ entered_balance: 0, penalties_count: 2 })).toBe(true)
    expect(hasBreakdown({ entered_balance: 0, penalties_count: 0, unpaid_dues: 3000 })).toBe(false)
    expect(hasBreakdown(null)).toBe(false)
  })
})