import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { totalSettledServiceReceipts } from './serviceReceiptSettlement'

describe('Official Receipts integrity', () => {
  it('adds linked service receipts without centavo drift', () => {
    expect(totalSettledServiceReceipts([
      { amount_paid: '0.10' },
      { amount_paid: '0.20' },
      { amount_paid: '15.05' },
    ])).toBe(15.35)
    expect(totalSettledServiceReceipts([])).toBe(0)
  })

  it('rejects missing or malformed settlement responses', () => {
    for (const value of [null, undefined, {}, 'bad']) {
      expect(() => totalSettledServiceReceipts(value)).toThrow()
    }
    for (const value of [null, 'NaN', '-5', '2.345', '', 'Infinity']) {
      expect(() => totalSettledServiceReceipts([{ amount_paid: value }])).toThrow()
    }
  })

  it('blocks receipt printing while settlement verification is incomplete', () => {
    const dialog = readFileSync(new URL('../components/ReceiptSheet.jsx', import.meta.url), 'utf8')
    expect(dialog).toContain('verificationLoading || verificationError')
    expect(dialog).toContain('role="alert"')
    expect(dialog).toContain('Boolean(verificationError)')
  })

  it('separates receipt list failures from empty history', () => {
    const page = readFileSync(new URL('../pages/OfficialReceiptsPage.jsx', import.meta.url), 'utf8')
    expect(page).toContain('listError ? (')
    expect(page).toContain('Receipt history could not be verified')
    expect(page).toContain('Finance Receipts Workspace')
    expect(page).toContain('useSettledAmountStatus')
  })

  it('retains the corrected summary and calendar migration', () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/20261104173454_correct_receipt_activity_and_void_totals.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain("status is distinct from 'Voided'")
    expect(migration).toContain('service_voided_count')
    expect(migration).toContain('homeowner_voided_count + s.service_voided_count')
  })
})
