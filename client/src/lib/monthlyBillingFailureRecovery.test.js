import { describe, expect, it } from 'vitest'
import { notificationLink } from './systemNotifications'
import { staffNotificationCopy } from './staffActivityText'

describe('incomplete monthly billing warnings and recovery', () => {
  it('keeps only safe month-scoped audit routes for staff', () => {
    for (const role of ['admin', 'secretary', 'treasurer']) {
      expect(notificationLink('/billing-audit?month=2026-12', role)).toBe('/billing-audit?month=2026-12')
    }
    expect(notificationLink('/billing-audit?month=2026-13')).toBe('/overdue-accounts')
    expect(notificationLink('/billing-audit?month=2026-12&next=https://example.com')).toBe('/overdue-accounts')
  })

  it('shows a clear warning for an incomplete month', () => {
    const item = {
      kind: 'collection_incomplete',
      title: 'Monthly Billing Incomplete — Needs Review',
      body: 'December 2026 monthly dues are incomplete. 1 of 663 eligible accounts are billed; 662 charges remain missing.',
      payload: { collection_date: '2026-12-03', missing_accounts: 662, recovery_status: 'incomplete' },
    }
    const copy = staffNotificationCopy(item)
    expect(copy.title).toContain('Needs Review')
    expect(copy.body).toContain('662 charges remain missing')
  })

  it('displays the recovered status without inventing a payment', () => {
    const copy = staffNotificationCopy({
      kind: 'collection_incomplete',
      title: 'Monthly Billing Recovered — December 2026',
      body: 'All 663 eligible charges are posted and the verified completion report is available. See Monthly Billing Audit.',
      payload: { recovery_status: 'recovered', missing_accounts: 0 },
    })
    expect(copy.title).toContain('Recovered')
    expect(copy.body).toContain('663 eligible charges')
    expect(copy.body).not.toMatch(/cash collected|payment received/i)
  })
})
