import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(
  new URL('../pages/TreasurerServiceRevenuePage.jsx', import.meta.url),
  'utf8',
)

describe('Treasurer Amenity Revenue receipt viewing', () => {
  it('shows a receipt action in transaction history', () => {
    expect(page).toContain('<th>Receipt</th>')
    expect(page).toContain('View Receipt')
    expect(page).toContain('aria-label={`View receipt ${t.receipt_number}`}')
  })

  it('opens the actual saved transaction', () => {
    expect(page).toContain('onClick={() => setSelectedReceipt(t)}')
  })

  it('uses the existing official receipt format', () => {
    expect(page).toContain("buildReceiptModel('service'")
    expect(page).toContain('<ReceiptDialog')
  })

  it('includes later balance settlements in receipt details', () => {
    expect(page).toContain('useSettledAmountStatus(selectedReceipt)')
    expect(page).toContain('settledAmount: settlement.amount')
  })

  it('supports existing receipt printing', () => {
    expect(page).toContain('printReceipt(')
    expect(page).toContain('setReceiptPrintNotice')
  })

  it('can close the receipt without saving a transaction', () => {
    expect(page).toContain(
      'onClose={() => setSelectedReceipt(null)}',
    )
  })
})