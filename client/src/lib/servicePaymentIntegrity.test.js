import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { hourlyBillableHours, serviceAmountDue } from './serviceBilling'

const page = readFileSync(new URL('../pages/ServicesManagementPage.jsx', import.meta.url), 'utf8')
const receipt = readFileSync(new URL('./receiptModel.js', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261104150129_unified_service_payment_integrity.sql', import.meta.url), 'utf8')

describe('Service payment integrity', () => {
  it('bills actual elapsed minutes, not 2-decimal rounded hours', () => {
    expect(hourlyBillableHours(540, 610)).toBe(1.1667)
    expect(serviceAmountDue({ rate: 100, rate_unit: 'per hour' }, 1.1667, 540, 610)).toBe(116.67)
    expect(serviceAmountDue({ rate: 50, rate_unit: 'per hour' }, 1.3333, 540, 620)).toBe(66.67)
    expect(serviceAmountDue({ rate: 100, rate_unit: 'per hour' }, 0.5, 540, 570)).toBe(50)
  })
  it('only allows whole countable service quantities', () => {
    const countable = { rate: 200, rate_unit: 'per person' }
    expect(serviceAmountDue(countable, 1.5)).toBe(0)
    expect(serviceAmountDue(countable, 2)).toBe(400)
    expect(page).toContain('Number.isSafeInteger(Number(transactionForm.quantity))')
    expect(migration).toContain('new.quantity <> trunc(new.quantity)')
  })
  it('checks both the rate and its unit before saving', () => {
    expect(page).toContain(".select('rate, rate_unit, is_active')")
    expect(page).toContain('unit_rate: Number(service.rate)')
    expect(page).toContain('rate_unit_snapshot: service.rate_unit')
    expect(migration).toContain('new.unit_rate <> svc.rate')
    expect(migration).toContain('new.rate_unit_snapshot <> svc.rate_unit')
    expect(migration).toContain('new.amount_due <> billed_amount')
  })
  it('makes new payments and balance collections retry-safe', () => {
    expect(page).toContain('setPaymentSubmissionKey(crypto.randomUUID())')
    expect(page).toContain('setCollectSubmissionKey(crypto.randomUUID())')
    expect(page).toContain(".eq('submission_key', paymentSubmissionKey).maybeSingle()")
    expect(page).toContain(".eq('submission_key', collectSubmissionKey).maybeSingle()")
    expect(migration).toContain('service_transactions_submission_key_unique')
  })
  it('preserves overlap confirmation and audit details', () => {
    expect(page).toContain('overlap_acknowledged_count: count')
    expect(page).toContain('bookingConfirmationResolver.current = resolve')
    expect(receipt).toContain("voidReason: row.void_reason || ''")
    expect(receipt).toContain("statusLabel: voided ? 'Voided'")
  })
})