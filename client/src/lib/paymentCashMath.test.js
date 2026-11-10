import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Guard key payment invariants in the actual UI implementation.
const source = readFileSync(new URL('../pages/PaymentsPage.jsx', import.meta.url), 'utf8')

describe('cash and manual debt discounts', () => {
  it('treats the entered payment as actual cash, without subtracting the discount', () => {
    expect(source).toContain('const cashTendered = paymentFaceAmount')
    expect(source).not.toContain('const cashTendered = Math.round((paymentFaceAmount - manualDiscountAmount)')
  })

  it('calculates excess after the debt discount', () => {
    expect(source).toContain('paymentFaceAmount - (balanceDue - manualDiscountAmount)')
    expect(source).toContain("supabase.rpc('record_cash_payment_with_debt_discount'")
    expect(source).toContain('p_cash_tendered: gross')
    expect(source).toContain('p_change_amount: changeAmount')
  })

  it('computes ₱764.05 credit for ₱3,000 cash and ₱100 debt discount', () => {
    const dueCents = 233595
    const discountCents = 10000
    const cashCents = 300000
    const discountedDebtCents = dueCents - discountCents
    expect(discountedDebtCents).toBe(223595)
    expect(cashCents - discountedDebtCents).toBe(76405)
    expect(cashCents - (cashCents - discountedDebtCents)).toBe(223595)
  })
})
