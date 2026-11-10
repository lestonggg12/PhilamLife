import { describe, expect, it } from 'vitest'
import { manualDiscountSettlesFullBalance } from './manualDiscountEligibility'

const eligible = (outstandingBalance, cashRetained, discountAmount, isBalanceReducingPayment = true) =>
  manualDiscountSettlesFullBalance({ outstandingBalance, cashRetained, discountAmount, isBalanceReducingPayment })

describe('manual discounts must settle the outstanding balance in full', () => {
  it('allows an exact full settlement', () => {
    expect(eligible(2335.95, 2235.95, 100)).toBe(true)
  })
  it('allows cash returned as change when only the discounted debt is retained', () => {
    // ₱4,000 tendered; ₱921.59 change; ₱3,078.41 retained; ₱150 debt discount.
    expect(eligible(3228.41, 3078.41, 150)).toBe(true)
  })
  it('rejects a partial payment even with a discount', () => {
    expect(eligible(2000, 500, 100)).toBe(false)
  })
  it('rejects any manual discount with retained advance credit', () => {
    expect(eligible(2335.95, 3000, 100)).toBe(false)
    expect(eligible(4358.31, 5000, 500)).toBe(false)
  })
  it('rejects no debt, non-balance purposes and invalid discount amounts', () => {
    expect(eligible(0, 500, 100)).toBe(false)
    expect(eligible(2000, 1900, 100, false)).toBe(false)
    expect(eligible(2000, 0, 2000)).toBe(false)
    expect(eligible(2000, 2000, 0)).toBe(false)
  })
})
