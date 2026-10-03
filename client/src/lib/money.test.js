import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountStatus, computeOverdueFromCharges } from './latepenalty'
import { advanceCreditDetails, advanceCreditNote } from './advanceCredit'

// Fixed "today": Oct 3, 2026 (Manila). Due day 10 + 10 grace days = deadline on the 20th.
const SETTINGS = { due_day: 10, grace_period_days: 10, late_penalty: 150, dues_amount: 1000, billing_day: 1 }
const RULES = { dueDay: 10, gracePeriodDays: 10, latePenalty: 150 }
const dues = (month) => ({ property_id: 1, amount: 1000, billing_month: month, created_at: `${month}T00:00:00Z`, charge_type: 'Association Dues' })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-03T09:00:00+08:00'))
})
afterEach(() => vi.useRealTimers())

describe('overdue rule', () => {
  it('never marks advance credit or a zero balance overdue', () => {
    expect(computeOverdueFromCharges({ balance: -500, charges: [dues('2026-09-01')], ...RULES }).isOverdue).toBe(false)
    expect(computeOverdueFromCharges({ balance: 0, charges: [dues('2026-09-01')], ...RULES }).isOverdue).toBe(false)
  })

  it('does not flag this month\'s dues before their deadline', () => {
    const r = computeOverdueFromCharges({ balance: 1000, charges: [dues('2026-10-01')], ...RULES })
    expect(r.isOverdue).toBe(false)
  })

  it('flags last month\'s unpaid dues after the 20th and counts days', () => {
    const r = computeOverdueFromCharges({ balance: 1000, charges: [dues('2026-09-01')], ...RULES })
    expect(r.isOverdue).toBe(true)
    expect(r.daysOverdue).toBe(13) // Sep 20 -> Oct 3
    expect(r.overdueAmount).toBe(1000)
    expect(r.penaltyAmount).toBe(150)
  })

  it('applies payments to the oldest charge first', () => {
    const charges = [dues('2026-09-01'), dues('2026-10-01')]
    // owes one month: the unpaid one is October (not yet overdue)
    expect(computeOverdueFromCharges({ balance: 1000, charges, ...RULES }).isOverdue).toBe(false)
    // owes both: September is overdue, October is not
    const both = computeOverdueFromCharges({ balance: 2000, charges, ...RULES })
    expect(both.isOverdue).toBe(true)
    expect(both.overdueAmount).toBe(1000)
  })

  it('judges a balance with no charge behind it by the old rule', () => {
    expect(computeOverdueFromCharges({ balance: 0.02, charges: [], ...RULES }).isOverdue).toBe(true)
  })

  it('does not show the display-only penalty once a real penalty charge exists', () => {
    const penalty = { property_id: 1, amount: 150, billing_month: null, created_at: '2026-10-02T00:00:00Z', charge_type: 'Penalty / Late Fee' }
    const r = computeOverdueFromCharges({ balance: 1150, charges: [dues('2026-09-01'), penalty], ...RULES })
    expect(r.isOverdue).toBe(true)
    expect(r.penaltyAmount).toBe(0)
  })

  it('clamps a due day of 31 to the last day of a 30-day month', () => {
    vi.setSystemTime(new Date('2026-11-30T09:00:00+08:00'))
    const args = { balance: 1000, charges: [dues('2026-11-01')], dueDay: 31, gracePeriodDays: 0, latePenalty: 0 }
    expect(computeOverdueFromCharges(args).isOverdue).toBe(false) // due today
    vi.setSystemTime(new Date('2026-12-01T09:00:00+08:00'))
    expect(computeOverdueFromCharges(args).isOverdue).toBe(true)
  })
})

describe('accountStatus', () => {
  it('splits the stored balance into owed and credit', () => {
    const owes = accountStatus({ id: 1, current_balance: 750 }, [], SETTINGS)
    expect(owes.balance).toBe(750)
    expect(owes.credit).toBe(0)
    const credit = accountStatus({ id: 1, current_balance: -600 }, [], SETTINGS)
    expect(credit.balance).toBe(0)
    expect(credit.credit).toBe(600)
    expect(credit.isOverdue).toBe(false)
  })

  it('only counts charges that belong to the property', () => {
    const other = { ...dues('2026-09-01'), property_id: 2 }
    expect(accountStatus({ id: 1, current_balance: 1000 }, [other], SETTINGS).isOverdue).toBe(true) // falls back to old rule (no own charges)
    expect(accountStatus({ id: 1, current_balance: 1000 }, [dues('2026-10-01')], SETTINGS).isOverdue).toBe(false)
  })
})

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