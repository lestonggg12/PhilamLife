import { describe, expect, it } from 'vitest'
import { staffNotificationCopy } from './staffActivityText'

describe('monthly billing completion notification v2', () => {
  it('preserves the database-verified assessment, credit, and unpaid portions', () => {
    const body = 'December 2026 association dues were assessed for 663 accounts, totaling ₱561,930.50. ' +
      'Credits applied: ₱101,452.09, including ₱300.00 generated during billing. ' +
      'New unpaid dues: ₱460,478.41. Total outstanding includes older balances. Not a cash receipt.'
    const result = staffNotificationCopy({
      kind: 'collection_run',
      title: 'Monthly Billing Applied — December 2026',
      body,
      payload: {
        report_version: 2, collection_date: '2026-12-03',
        billed_accounts: 663, credit_deducted_formatted: '₱101,452.09',
        credit_accounts: 138, new_unpaid_formatted: '₱460,478.41',
        unpaid_accounts: 526, unpaid_total_formatted: '₱1,196,976.92',
      },
    })
    expect(result.title).toBe('Monthly Billing Applied — December 2026')
    expect(result.body).toBe(body)
    expect(result.body).toContain('₱300.00 generated during billing')
    expect(result.body).not.toContain('526 accounts without advance credit')
  })

  it('keeps the server review warning instead of presenting an unverified success', () => {
    const result = staffNotificationCopy({
      kind: 'collection_run',
      title: 'Monthly Billing Needs Review — December 2026',
      body: 'Two monthly charges have incomplete credit/unpaid activity evidence.',
      payload: { report_version: 2, allocation_evidence_incomplete: true },
    })
    expect(result.title).toContain('Needs Review')
    expect(result.body).toContain('incomplete credit/unpaid activity evidence')
  })
})
