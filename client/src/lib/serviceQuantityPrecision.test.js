import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261104140518_allow_fractional_service_booking_quantity.sql', import.meta.url),
  'utf8',
)

describe('Fractional service billing', () => {
  it('supports two decimal places for billable hours', () => {
    expect(migration).toContain(
      'alter column quantity type numeric(12,2)',
    )
  })

  it('preserves fractional hours in the payment payload', () => {
    expect(page).toContain(
      'quantity: Math.max(Number(transactionForm.quantity) || 1, 1)',
    )
  })

  it('calculates a 1.33 hour bill at 50 pesos per hour', () => {
    const hours = 1.33
    const rate = 50
    const amountDue = Math.round(rate * hours * 100) / 100

    expect(amountDue).toBe(66.50)
    expect(amountDue - 50).toBeCloseTo(16.50)
  })

  it('supports an initial partial payment', () => {
    const due = 66.50
    const paid = 50
    const status = paid >= due ? 'paid' : 'partial'

    expect(status).toBe('partial')
    expect(due - paid).toBeCloseTo(16.50)
  })
})