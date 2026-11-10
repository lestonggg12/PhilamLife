import { expect, it } from 'vitest'
import { homeownerPaymentTotals, paymentTrackerStatus, serviceInvoiceBalances } from './homeownerPaymentPeriods'

it('uses Manila payment dates and counts each non-voided regular and service receipt once', () => {
  const payments = [
    { paidAt: '2025-12-31T15:59:59Z', amount: 75, kind: 'dues', statusKey: 'completed' },
    { paidAt: '2025-12-31T16:00:00Z', amount: 100.10, kind: 'dues', statusKey: 'completed' },
    { paidAt: '2026-01-31T15:59:59Z', amount: 25.15, kind: 'services', statusKey: 'partial' },
    { paidAt: '2026-01-31T16:00:00Z', amount: 40, kind: 'services', statusKey: 'paid' },
    { paidAt: '2026-02-01T02:00:00Z', amount: 500, kind: 'other', statusKey: 'voided' },
    { paidAt: null, amount: 30, kind: 'other', statusKey: 'recorded' },
  ]

  expect(homeownerPaymentTotals(payments, '2026-01')).toEqual({ thisMonth: 125.25, thisYear: 125.25, allTime: 270.25 })
  expect(homeownerPaymentTotals(payments, '2026-02')).toEqual({ thisMonth: 40, thisYear: 165.25, allTime: 270.25 })
})

it('describes recorded transactions without certifying monthly dues as paid', () => {
  expect(paymentTrackerStatus([{ kind: 'services', statusKey: 'paid' }]).label).toBe('Payments recorded')
  expect(paymentTrackerStatus([{ kind: 'dues', statusKey: 'partial' }]).label).toMatch(/partial/)
  expect(paymentTrackerStatus([]).label).toBe('No payments recorded')
})

it('settles an invoice in exact centavos and disregards voided settlements', () => {
  const invoice = { id: 'invoice', amount_due: '50.00', amount_paid: '46.12', payment_status: 'partial' }
  const payment = { id: 'settlement', balance_of: 'invoice', amount_due: '3.88', amount_paid: '3.88', payment_status: 'paid' }
  expect(serviceInvoiceBalances([invoice, payment]).get('invoice')).toBe(0)
  expect(serviceInvoiceBalances([invoice, { ...payment, payment_status: 'voided' }]).get('invoice')).toBe(3.88)
})
