import { describe, expect, it } from 'vitest'
import { buildSystemSettingsPayload } from './systemSettingsDraft'

const draft = () => ({
  hoa_name: ' PHILAM Village ', address: ' City ', contact_email: '', contact_phone: '',
  billing_day: '3', due_day: '3', grace_period_days: '0', session_timeout: '30',
  require_strong_password: true, currency: 'PHP', timezone: 'Asia/Manila',
  date_format: 'MM/DD/YYYY',
})

describe('safe system settings updates', () => {
  it('saves only fields controlled by the current form', () => {
    const payload = buildSystemSettingsPayload({
      ...draft(), id: 1, price_per_sqm: 4, late_penalty_rate: 0.015,
      late_penalty_first_after_months: 12, updated_at: 'old',
      email_on_payment: false, dues_amount: 5000,
    })
    expect(payload.hoa_name).toBe('PHILAM Village')
    expect(payload.billing_day).toBe(3)
    expect(Object.keys(payload)).toHaveLength(12)
    for (const key of ['id', 'dues_amount', 'price_per_sqm', 'late_penalty_rate', 'email_on_payment', 'updated_at']) {
      expect(payload).not.toHaveProperty(key)
    }
  })
  it.each([
    ['billing_day', ''], ['due_day', '1.5'], ['grace_period_days', ''],
    ['grace_period_days', '2.5'], ['grace_period_days', '-1'],
    ['session_timeout', ''], ['session_timeout', 'Infinity'],
    ['due_day', '0'], ['session_timeout', '1441'],
  ])('rejects invalid %s: %s', (field, value) => {
    expect(() => buildSystemSettingsPayload({ ...draft(), [field]: value })).toThrow()
  })
  it('rejects due days before billing and unsupported regional preferences', () => {
    expect(() => buildSystemSettingsPayload({ ...draft(), billing_day: '12', due_day: '3' })).toThrow('after')
    expect(() => buildSystemSettingsPayload({ ...draft(), currency: 'USD' })).toThrow('PHP')
    expect(() => buildSystemSettingsPayload({ ...draft(), date_format: 'unknown' })).toThrow('date format')
  })
  it('keeps optional contact details nullable and rejects invalid email', () => {
    expect(buildSystemSettingsPayload(draft()).contact_email).toBeNull()
    expect(() => buildSystemSettingsPayload({ ...draft(), contact_email: 'not-email' })).toThrow('email')
  })
})
