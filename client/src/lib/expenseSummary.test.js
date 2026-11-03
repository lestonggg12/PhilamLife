import { describe, expect, it } from 'vitest'
import { expenseCents, parseExpenseAmount, isValidExpenseDate, isVoidedExpense, summarizeExpenses } from './expenseSummary'

describe('expense recording validation', () => {
  it('accepts exact peso centavos', () => {
    expect(parseExpenseAmount('100.05')).toBe(100.05)
    expect(expenseCents('0.01')).toBe(1)
  })
  it.each(['', 'NaN', 'Infinity', '-1', '0.001', '1e5', '1.234', '1,000', '99999999999'])('rejects invalid money %s', (value) => {
    expect(() => parseExpenseAmount(value)).toThrow()
  })
  it.each(['2026-02-30', '2026-13-01', '', '2026-1-01'])('rejects invalid calendar day %s', (value) => {
    expect(isValidExpenseDate(value)).toBe(false)
  })
  it('permits a valid leap-day date', () => {
    expect(isValidExpenseDate('2024-02-29')).toBe(true)
  })
})

describe('financial expense summaries', () => {
  const rows = [
    { expense_date: '2026-11-01', amount: '0.10', category: 'Utilities', status: 'Completed' },
    { expense_date: '2026-11-02', amount: '0.20', category: 'Utilities', status: 'Recorded' },
    { expense_date: '2026-10-01', amount: '3.25', category: 'Other', status: 'Completed' },
    { expense_date: '2026-11-02', amount: '999.00', category: 'Other', status: 'voided' },
  ]
  it('sums centavos and excludes cancelled expense entries', () => {
    expect(summarizeExpenses(rows, '2026-11')).toEqual({
      totalAllTime: 3.55, totalSelectedMonth: 0.3, count: 2,
      topCategory: { name: 'Utilities', amount: 0.3 },
    })
  })
  it('recognizes void status regardless of casing', () => {
    expect(isVoidedExpense({ status: ' VOIDED ' })).toBe(true)
  })
  it('refuses corrupt history instead of reporting zero expenses', () => {
    expect(() => summarizeExpenses([{ expense_date: '2026-11-02', amount: 'NaN' }], '2026-11')).toThrow('Expense amount')
  })
})
