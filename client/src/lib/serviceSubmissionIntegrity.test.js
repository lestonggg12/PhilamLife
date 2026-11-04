import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  serviceSubmissionSnapshot,
  sameServiceSubmission,
  assertServiceReceiptMatches,
} from './serviceSubmissionIntegrity'

const source = readFileSync(new URL('../pages/ServicesManagementPage.jsx', import.meta.url), 'utf8')
const primary = {
  submission_key: '11111111-1111-4111-8111-111111111111',
  property_id: 42, service_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  service_date: '2026-11-05', start_time: '18:10', end_time: '19:20',
  quantity: 1.1667, unit_rate: 100, rate_unit_snapshot: 'per hour',
  amount_due: 116.67, amount_paid: 50, payment_method: 'Cash',
  reference_number: null, notes: 'first renter', recorded_by: 'user-1',
}
const collection = {
  submission_key: '22222222-2222-4222-8222-222222222222',
  balance_of: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  property_id: 42, service_id: primary.service_id,
  amount_paid: 66.67, payment_method: 'GCash',
  reference_number: 'GC-222', notes: 'last installment', recorded_by: 'user-1',
}
const saved = (input, extra = {}) => ({
  ...input,
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  receipt_number: 'SR-TEST-001', payment_status: 'partial',
  start_time: input.start_time ? `${input.start_time}:00` : null,
  end_time: input.end_time ? `${input.end_time}:00` : null,
  quantity: input.quantity == null ? 1 : String(input.quantity),
  amount_due: String(input.amount_due ?? input.amount_paid),
  amount_paid: String(input.amount_paid),
  ...extra,
})

describe('Service submission idempotency', () => {
  it('matches exactly the immutable original payment intent', () => {
    const snapshot = serviceSubmissionSnapshot('payment', primary)
    expect(sameServiceSubmission(snapshot, serviceSubmissionSnapshot('payment', { ...primary }))).toBe(true)
    expect(assertServiceReceiptMatches(snapshot, saved(primary))).toHaveProperty('receipt_number')
  })
  it.each([
    ['property', { property_id: 43 }],
    ['service', { service_id: 'another' }],
    ['time', { end_time: '19:25' }],
    ['quantity', { quantity: 1.25 }],
    ['amount', { amount_paid: 51 }],
    ['method', { payment_method: 'GCash' }],
    ['notes', { notes: 'updated after submission' }],
  ])('rejects changed %s before retrying the same key', (_, change) => {
    const snapshot = serviceSubmissionSnapshot('payment', primary)
    expect(sameServiceSubmission(snapshot, serviceSubmissionSnapshot('payment', { ...primary, ...change }))).toBe(false)
  })
  it('refuses a receipt with a matching key but different amount or booking', () => {
    const snapshot = serviceSubmissionSnapshot('payment', primary)
    expect(() => assertServiceReceiptMatches(snapshot, saved(primary, { amount_paid: '60.00' }))).toThrow(/differs/)
    expect(() => assertServiceReceiptMatches(snapshot, saved(primary, { end_time: '20:00:00' }))).toThrow(/differs/)
    expect(() => assertServiceReceiptMatches(snapshot, saved(primary, { submission_key: 'wrong-key' }))).toThrow(/differs/)
  })
  it('rejects voided or unconfirmed receipts', () => {
    const snapshot = serviceSubmissionSnapshot('payment', primary)
    expect(() => assertServiceReceiptMatches(snapshot, saved(primary, { payment_status: 'voided' }))).toThrow(/could not be verified/)
    expect(() => assertServiceReceiptMatches(snapshot, null)).toThrow(/could not be verified/)
  })
  it('matches settlement receipts with server-prefixed notes', () => {
    const snapshot = serviceSubmissionSnapshot('collection', collection)
    expect(assertServiceReceiptMatches(snapshot, saved(collection, {
      notes: 'Balance payment for SR-2026-000013 â€” last installment',
      payment_status: 'paid',
    }))).toHaveProperty('receipt_number')
    expect(() => assertServiceReceiptMatches(snapshot, saved(collection, {
      notes: 'Balance payment for SR-2026-000013 â€” different notes',
    }))).toThrow(/notes differ/)
  })
  it('refuses a changed settlement amount or parent receipt', () => {
    const snapshot = serviceSubmissionSnapshot('collection', collection)
    expect(sameServiceSubmission(snapshot, serviceSubmissionSnapshot('collection', { ...collection, amount_paid: 50 }))).toBe(false)
    expect(() => assertServiceReceiptMatches(snapshot, saved(collection, { balance_of: 'different-parent' }))).toThrow(/differs/)
  })
  it('checks for a previous receipt before retrying either kind', () => {
    expect(source).toContain('if (paymentAttemptRef.current) {')
    expect(source).toContain('if (collectAttemptRef.current) {')
    expect(source).toContain('assertServiceReceiptMatches(paymentAttemptRef.current, recovered.data)')
    expect(source).toContain('assertServiceReceiptMatches(collectAttemptRef.current, recovered.data)')
  })
  it('freezes each first attempted payload before inserting it', () => {
    expect(source).toContain('paymentAttemptRef.current = paymentIntent')
    expect(source).toContain('collectAttemptRef.current = collectionIntent')
    expect(source).toContain('inert={saving ? "inert" : undefined}')
  })
})