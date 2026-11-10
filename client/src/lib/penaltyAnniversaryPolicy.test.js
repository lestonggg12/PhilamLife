import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(new URL('../../../supabase/migrations/20261111033000_fix_monthly_dues_penalty_anniversary.sql', import.meta.url), 'utf8')

const scheduledDay = (isoMonth, day) => {
  const [year, month] = isoMonth.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${isoMonth}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
}

describe('annual penalty dates for recurring association dues', () => {
  it('starts 12 months after the configured billing day rather than the month key', () => {
    expect(scheduledDay('2026-11', 3)).toBe('2026-11-03')
    expect(scheduledDay('2027-11', 3)).toBe('2027-11-03')
    expect(scheduledDay('2026-10', 3)).toBe('2026-10-03')
  })
  it('clamps billing dates for February including leap years', () => {
    expect(scheduledDay('2027-02', 31)).toBe('2027-02-28')
    expect(scheduledDay('2028-02', 31)).toBe('2028-02-29')
    expect(scheduledDay('2027-04', 31)).toBe('2027-04-30')
  })
  it('persists a date snapshot when charges are created and protects it from edits', () => {
    expect(migration).toContain('scheduled_bill_on')
    expect(migration).toContain('BEFORE INSERT ON public.property_charges')
    expect(migration).toContain('BEFORE UPDATE ON public.property_charges')
    expect(migration).toContain('NEW.as_of_date:=v_bill_date')
  })
  it('keeps the original anniversary in a dedicated audit and forbids assessed-penalty rewrites', () => {
    expect(migration).toContain('annual_penalty_anchor_corrections')
    expect(migration).toContain('old_anchor')
    expect(migration).toContain('corrected_anchor')
    expect(migration).toContain('annual_penalty_assessments')
    expect(migration).toContain('s.next_anniversary_no<>1')
  })
  it('does not change payments, dues amounts, or annual penalty assessments', () => {
    expect(migration).not.toMatch(/\bUPDATE\s+public\.(payments|annual_penalty_assessments)\b/i)
    expect(migration).not.toMatch(/\bUPDATE\s+public\.property_charges\s+\w*\s*SET\s+(amount|current_balance)\b/i)
  })
})
