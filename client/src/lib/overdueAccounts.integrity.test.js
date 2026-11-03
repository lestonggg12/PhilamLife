import { describe, expect, it } from 'vitest'
import { verifyOverdueSnapshot } from './overdueAccounts'

const property = { id: 5, current_balance: 1000 }
const aging = { property_id: 5, balance: 1000, overdue_amount: 700, aging_complete: true }
const settings = { due_day: 3, grace_period_days: 0 }

describe('Overdue snapshot integrity', () => {
  it('accepts a complete, reconciled snapshot', () => {
    expect(() => verifyOverdueSnapshot([property], [], settings, [aging])).not.toThrow()
  })
  it('rejects missing billing settings and missing results', () => {
    expect(() => verifyOverdueSnapshot([property], [], null, [aging])).toThrow('Incomplete')
    expect(() => verifyOverdueSnapshot([property], null, settings, [aging])).toThrow('Incomplete')
  })
  it('rejects missing, duplicate and invalid aging rows', () => {
    expect(() => verifyOverdueSnapshot([property], [], settings, [])).toThrow('do not match')
    expect(() => verifyOverdueSnapshot([property], [], settings, [aging, aging])).toThrow('invalid financial data')
    expect(() => verifyOverdueSnapshot([property], [], settings, [{ ...aging, overdue_amount: 'NaN' }])).toThrow('invalid financial data')
  })
  it('rejects an invalid property balance', () => {
    expect(() => verifyOverdueSnapshot([{ ...property, current_balance: null }], [], settings, [aging])).toThrow('do not match')
  })
})
