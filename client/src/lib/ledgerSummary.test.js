import { expect, it } from 'vitest'
import { summarizeLedgerEntries, verifiedLedgerAging, verifyLedgerSources } from './ledgerSummary'

const lot = { id: 1, current_balance: '-100.25', opening_balance: null, homeowner_status: 'active' }
const financial = { property_id: 1, stored_balance: '-100.25', opening_balance: '0.00', active_charges: '0.00', homeowner_status: 'active' }
const age = { property_id: 1, total_due: 0, overdue_amount: 0, current_amount: 0, is_overdue: false, aging_complete: true }
const payment = { property_id: 1, total_paid: '90.20', latest_amount_paid: '90.20', latest_previous_balance: '0.00' }

it('keeps charges, collections, amounts due, and available credit distinct', () => {
  expect(summarizeLedgerEntries([
    { recordedCharges: '0.00', totalPaid: '90.20', balance: '0.00', unallocatedCredit: '100.25' },
    { recordedCharges: '120.10', opening_balance: '50.11', totalPaid: '20.21', balance: '150.00', unallocatedCredit: '0.00' },
    { recordedCharges: '0.01', opening_balance: '-30.00', totalPaid: '0.00', balance: '0.00', unallocatedCredit: '29.99' },
  ])).toEqual({ totalDue: 170.22, totalPaid: 110.41, totalBalance: 150, totalCredit: 130.24 })
})

it('accepts a complete snapshot and distinguishes zero receivables from a signed credit', () => {
  const { financial: index } = verifyLedgerSources([lot], [financial], [payment], [age], [])
  expect(index.get('1')).toEqual(financial)
  expect(verifiedLedgerAging(lot.current_balance, age)).toBe(true)
})

it('rejects missing, duplicate, mismatched and invalid source results', () => {
  expect(() => verifyLedgerSources([lot], [], [payment], [age], [])).toThrow('different lots')
  expect(() => verifyLedgerSources([lot], [financial], [payment, payment], [age], [])).toThrow('duplicate lot')
  expect(() => verifyLedgerSources([lot], [{ ...financial, stored_balance: -50 }], [payment], [age], [])).toThrow('changed')
  expect(() => verifyLedgerSources([lot], [financial], [{ ...payment, total_paid: 'NaN' }], [age], [])).toThrow('Invalid')
})

it('flags aging that cannot be reconciled without rewriting the balance', () => {
  expect(verifiedLedgerAging(50, { ...age, overdue_amount: 20, current_amount: 30, is_overdue: true })).toBe(true)
  expect(verifiedLedgerAging(50, { ...age, overdue_amount: 20, current_amount: 29.99, is_overdue: true })).toBe(false)
  expect(verifiedLedgerAging(50, { ...age, overdue_amount: 20, current_amount: 30 })).toBe(false)
})
