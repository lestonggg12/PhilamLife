import { describe, expect, it } from 'vitest'
import { accountLedgerStatus, isValidManualChargeDueDate } from './manualChargeDueDate'

describe('custom manual charge due dates', () => {
  it('accepts today and future Manila calendar dates', () => {
    expect(isValidManualChargeDueDate('2026-11-03', '2026-11-03')).toBe(true)
    expect(isValidManualChargeDueDate('2026-11-15', '2026-11-03')).toBe(true)
  })
  it.each(['2026-11-02', '2026-02-30', '2026-13-01', '', '2026-1-03'])('rejects invalid or past date: %s', (date) => {
    expect(isValidManualChargeDueDate(date, '2026-11-03')).toBe(false)
  })
})

describe('ledger status priority', () => {
  const base = { balance: 10000, agingComplete: true, isOverdue: false, hasPartialPayment: true }
  it('shows partial when part of an obligation was settled before deadline', () => {
    expect(accountLedgerStatus(base)).toBe('Partially Paid')
  })
  it('prioritizes overdue, paid, and review states', () => {
    expect(accountLedgerStatus({ ...base, isOverdue: true })).toBe('Overdue')
    expect(accountLedgerStatus({ ...base, balance: 0 })).toBe('Paid')
    expect(accountLedgerStatus({ ...base, agingComplete: false })).toBe('Review')
  })
})
