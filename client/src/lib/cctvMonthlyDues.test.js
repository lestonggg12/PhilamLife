import { describe, expect, it } from 'vitest'
import { cctvMonthlyDues } from './cctvMonthlyDues'

const ongoing = [{ monthly_credit: '200.00', starts_on: '2026-11-01', ends_before: null }]

describe('monthly dues with CCTV electricity compensation', () => {
  it('shows net dues for an approved ongoing month', () => {
    expect(cctvMonthlyDues('800.00', '2026-12-01', ongoing)).toEqual({ gross: 800, credit: 200, net: 600 })
  })
  it('does not credit months before the start', () => {
    expect(cctvMonthlyDues(800, '2026-10-01', ongoing).net).toBe(800)
  })
  it('honors the database-exclusive end month', () => {
    const schedule = [{ ...ongoing[0], ends_before: '2027-01-01' }]
    expect(cctvMonthlyDues(800, '2026-12-01', schedule).net).toBe(600)
    expect(cctvMonthlyDues(800, '2027-01-01', schedule).net).toBe(800)
  })
  it('caps credits at regular dues', () => {
    expect(cctvMonthlyDues('150.00', '2026-12-01', ongoing)).toEqual({ gross: 150, credit: 150, net: 0 })
  })
  it('keeps centavos exact', () => {
    const schedule = [{ ...ongoing[0], monthly_credit: '100.25' }]
    expect(cctvMonthlyDues('812.45', '2026-12-01', schedule).net).toBe(712.2)
  })
  it('does not invent a credit without a verified month', () => {
    expect(cctvMonthlyDues(800, null, ongoing).credit).toBe(0)
  })
})
