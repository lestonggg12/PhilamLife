import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { expenseDateControlError, expenseEvidenceControlError } from './expenseEntryControls'
import { financialSubmissionIntent, assertFinancialSubmissionMatches } from './financialSubmissionIntegrity'
const page = readFileSync(new URL('../pages/TreasurerExpensesPage.jsx', import.meta.url), 'utf8')
const reports = readFileSync(new URL('../pages/ReportsPage.jsx', import.meta.url), 'utf8')
const pdf = readFileSync(new URL('./monthlyReportPdf.js', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../../supabase/migrations/20261104164048_expense_documentation_and_period_controls.sql', import.meta.url), 'utf8')

describe('Expense date and documentation safeguards', () => {
  it('accepts current date and valid documented past expense', () => {
    expect(expenseDateControlError('2026-11-05', '2026-11-05', '')).toBe('')
    expect(expenseDateControlError('2026-11-04', '2026-11-05', 'Received late from supplier')).toBe('')
  })
  it('rejects future date, impossible date and unjustified backdating', () => {
    expect(expenseDateControlError('2026-11-06', '2026-11-05', '')).toMatch(/Future/)
    expect(expenseDateControlError('2026-02-30', '2026-11-05', '')).toMatch(/valid/)
    expect(expenseDateControlError('2026-11-04', '2026-11-05', '')).toMatch(/Explain/)
    expect(expenseDateControlError('2026-11-05', '2026-11-05', 'A reason')).toMatch(/only/)
  })
  it('requires either reference or a meaningful explanation', () => {
    expect(expenseEvidenceControlError('INV-444', '')).toBe('')
    expect(expenseEvidenceControlError('', 'Supplier did not issue a receipt')).toBe('')
    expect(expenseEvidenceControlError('', '')).toMatch(/explain/)
    expect(expenseEvidenceControlError('  ', 'short')).toMatch(/explain/)
    expect(expenseEvidenceControlError('', 'x'.repeat(501))).toMatch(/explain/)
  })
  it('keeps documentation and backdating reasons immutable during retry recovery', () => {
    const payload = { submission_key: 'id', recorded_by: 'treasurer', expense_date: '2026-11-04', category: 'Utilities',
      description: 'Bill', amount: 150, reference_number: null, supporting_note: 'No reference available', backdate_reason: 'Invoice submitted after date' }
    const original = financialSubmissionIntent('expense', payload)
    expect(() => assertFinancialSubmissionMatches(original, { ...payload, id: 'saved', status: 'Completed' })).not.toThrow()
    for (const override of [{ supporting_note: 'Different explanation' }, { backdate_reason: null }]) {
      expect(() => assertFinancialSubmissionMatches(original, { ...payload, ...override, id: 'saved', status: 'Completed' })).toThrow()
    }
  })
  it('keeps UI, report and PDF aligned with recorded evidence', () => {
    expect(page).toContain('expenseEvidenceControlError(form.reference_number, form.supporting_note)')
    expect(page).toContain('expenseDateControlError(form.expense_date, todayISO(), form.backdate_reason)')
    expect(page).toContain('Legacy cancellation: actor, time and reason were not recorded.')
    expect(reports).toContain('supporting_note, backdate_reason')
    expect(pdf).toContain('No ref. (explained)')
  })
  it('enforces the same rules on the server, including closed accounting periods', () => {
    expect(migration).toContain("today_manila date := (now() at time zone 'Asia/Manila')::date")
    expect(migration).toContain('new.expense_date > today_manila')
    expect(migration).toContain('new.expense_date < today_manila')
    expect(migration).toContain('new.supporting_note')
    expect(migration).toContain("ap.status = 'closed'")
    expect(migration).toContain("ap.status='closed'")
    expect(migration).toContain('new.submission_key := old.submission_key')
  })
})