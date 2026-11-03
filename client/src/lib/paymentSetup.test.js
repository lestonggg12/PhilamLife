import { describe, expect, it } from 'vitest'
import { paymentSetupErrors } from './paymentSetup'

const complete = {
  propertyResult: { data: [{ id: 1, current_balance: '100.00' }], error: null },
  settingsResult: { data: { billing_day: 1 }, error: null },
  billedResult: { data: [], error: null },
  duesResult: { data: [{ property_id: 1, monthly_dues: '200.00' }], error: null },
}

describe('verified payment setup', () => {
  it('accepts a complete snapshot including a negative credit balance', () => {
    expect(paymentSetupErrors(complete)).toEqual([])
    expect(paymentSetupErrors({ ...complete, propertyResult: { data: [{ current_balance: '-15.00' }] } })).toEqual([])
  })
  it.each([null, 'NaN', 'Infinity'])('rejects an unverified balance %s', (balance) => {
    const snapshot = { ...complete, propertyResult: { data: [{ current_balance: balance }] } }
    expect(paymentSetupErrors(snapshot)).not.toEqual([])
  })
  it('rejects missing data instead of replacing valid records with empty lists', () => {
    expect(paymentSetupErrors({ ...complete, duesResult: { data: null, error: null } })).not.toEqual([])
    expect(paymentSetupErrors({ ...complete, settingsResult: { data: null } })).not.toEqual([])
  })
  it('preserves a query failure as a setup error', () => {
    expect(paymentSetupErrors({ ...complete, billedResult: { error: { message: 'Permission denied' }, data: null } }).join(' ')).toContain('Permission denied')
  })
})
