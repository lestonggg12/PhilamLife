import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { financialSubmissionIntent, assertFinancialSubmissionMatches, requireUnchangedFinancialAttempt } from './financialSubmissionIntegrity'

const payments = readFileSync(new URL('../pages/PaymentsPage.jsx', import.meta.url), 'utf8')
const expenses = readFileSync(new URL('../pages/TreasurerExpensesPage.jsx', import.meta.url), 'utf8')
const report = readFileSync(new URL('./monthlyReportData.js', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261104161127_payment_expense_retry_keys.sql', import.meta.url), 'utf8')

const payment = {
  submission_key: 'retry-uuid', property_id: 14, recorded_by: 'actor-uuid',
  charge_type: 'Association Dues', coverage_period: 'Association Dues — November',
  amount: '100.00', amount_paid: '100.00', payment_method: 'Cash',
  reference_number: null, note: null,
}
const expense = {
  submission_key: 'expense-uuid', recorded_by: 'actor-uuid',
  expense_date: '2026-11-05', category: 'Utilities', description: 'Electric bill',
  amount: '125.00', reference_number: null,
}

describe('Treasurer financial submission recovery', () => {
  it('accepts only the same persisted payment intent', () => {
    const intent = financialSubmissionIntent('payment', payment)
    const saved = { ...payment, id: 9001, receipt_number: 'OR-2026-000900', status: 'Completed', receipt_breakdown: { dues: 1 } }
    expect(assertFinancialSubmissionMatches(intent, saved)).toBe(saved)
    for (const change of [
      { property_id: 15 }, { submission_key: 'another-uuid' },
      { amount_paid: 101 }, { coverage_period: 'December' },
      { reference_number: 'GC-123' }, { note: 'new memo' },
      { status: 'Voided' },
    ]) {
      expect(() => assertFinancialSubmissionMatches(intent, { ...saved, ...change })).toThrow()
    }
  })
  it('retains the original discount intent', () => {
    const annual = { ...payment, amount: 1200, amount_paid: 1100,
      receipt_breakdown: { annual_advance_discount: { months_covered: 12, gross_amount: 1200, discount_amount: 100 } },
    }
    const intent = financialSubmissionIntent('payment', annual)
    expect(() => assertFinancialSubmissionMatches(intent, { ...annual, id: 1, receipt_number: 'OR-1', status: 'Completed' })).not.toThrow()
    expect(() => assertFinancialSubmissionMatches(intent, { ...annual, id: 1, receipt_number: 'OR-1', status: 'Completed', receipt_breakdown: { annual_advance_discount: { months_covered: 12, gross_amount: 1200, discount_amount: 99 } } })).toThrow()
  })
  it('detects edited forms after the first submission', () => {
    const first = financialSubmissionIntent('payment', payment)
    expect(() => requireUnchangedFinancialAttempt(first, financialSubmissionIntent('payment', { ...payment, amount_paid: 200 }))).toThrow()
    expect(() => requireUnchangedFinancialAttempt(first, financialSubmissionIntent('payment', payment))).not.toThrow()
  })
  it('checks expense identity, date, category, amount and description', () => {
    const intent = financialSubmissionIntent('expense', expense)
    const saved = { ...expense, id: 'expense-id', status: 'Completed' }
    expect(assertFinancialSubmissionMatches(intent, saved)).toBe(saved)
    for (const change of [{ amount: 200 }, { category: 'Security' }, { description: 'Changed' }, { expense_date: '2026-11-06' }, { submission_key: 'wrong' }, { status: 'Voided' }]) {
      expect(() => assertFinancialSubmissionMatches(intent, { ...saved, ...change })).toThrow()
    }
  })
  it('checks for old receipts before any new payment or expense attempt', () => {
    expect(payments).toContain(".eq('submission_key', paymentSubmissionKey).maybeSingle()")
    expect(expenses).toContain(".eq('submission_key', expenseSubmissionKey).maybeSingle()")
    expect(payments).toContain('paymentAttemptRef.current = paymentIntent')
    expect(expenses).toContain('expenseAttemptRef.current = expenseIntent')
    expect(payments).toContain('requireUnchangedFinancialAttempt')
    expect(expenses).toContain('requireUnchangedFinancialAttempt')
  })
  it('does not relabel the management surplus as reconciled bank cash', () => {
    expect(report).toContain('not a bank-reconciled balance')
    expect(report).toContain('not been independently audited')
  })
  it('preserves legacy records and immutable unique submission IDs', () => {
    expect(migration).toContain('add column if not exists submission_key uuid')
    expect(migration).toContain('payments_submission_key_unique')
    expect(migration).toContain('expenses_submission_key_unique')
    expect(migration).toContain('new.submission_key is distinct from old.submission_key')
    expect(payments).toContain('Historical record — recorder account not linked')
  })
})