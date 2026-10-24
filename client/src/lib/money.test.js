import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { advanceCreditDetails, advanceCreditNote } from './advanceCredit'

// Fixed "today": Oct 3, 2026 (Manila). Due day 10 + 10 grace days = deadline on the 20th.
const SETTINGS = { due_day: 10, grace_period_days: 10, late_penalty: 150, monthly_dues: 1000, billing_day: 1 }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-03T09:00:00+08:00'))
})
afterEach(() => vi.useRealTimers())

describe('advance credit note', () => {
  it('uses next month\'s billing day when this month is already billed', () => {
    const d = advanceCreditDetails(2500, { ...SETTINGS, billed_this_month: true })
    expect(d.billing).toBe('November 1, 2026')
    expect(d.due).toBe('November 10, 2026')
    expect(d.deadline).toBe('November 20, 2026')
    expect(d.months).toBe(2)
    expect(d.rest).toBe(500)
  })

  it('follows a different billing day', () => {
    const d = advanceCreditDetails(1000, { ...SETTINGS, billing_day: 5, due_day: 10, billed_this_month: true })
    expect(d.billing).toBe('November 5, 2026')
  })

  it('bills tomorrow if this month is not billed yet and the day has passed', () => {
    const d = advanceCreditDetails(1000, { ...SETTINGS, billed_this_month: false })
    expect(d.billing).toBe('October 4, 2026')
  })

  it('says how much is still due when credit is under one month', () => {
    const note = advanceCreditNote(400, { ...SETTINGS, billed_this_month: true })
    expect(note).toContain('less than one month')
    expect(note).toContain('600.00')
  })

  it('falls back to a generic note without settings', () => {
    expect(advanceCreditNote(200, null)).toContain('advance credit')
  })
})