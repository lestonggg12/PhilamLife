import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HomeownerLotChips from '../components/HomeownerLotChips'
import { duplicateLotMessage, isDuplicateLotError } from './homeownerLots'
import { buildReceiptModel } from './receiptModel'

const lots = [
  { id: 101, homeowner_id: 'person-1', block: 'Block A', lot_number: 12 },
  { id: 102, homeowner_id: 'person-1', block: 'Block B', lot_number: 7 },
]

describe('multiple lot profile', () => {
  it('adds no lot selector markup for a one-lot homeowner', () => {
    expect(renderToStaticMarkup(<HomeownerLotChips lots={[lots[0]]} selectedId={101} onSelect={() => {}} />)).toBe('')
  })
  it('labels each lot separately and marks only the selected property', () => {
    const html = renderToStaticMarkup(<HomeownerLotChips lots={lots} selectedId="102" onSelect={() => {}} />)
    expect(html).toContain('Block A, Lot 12')
    expect(html).toContain('Block B, Lot 7')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toContain('aria-current="page">Block B, Lot 7')
  })
  it('formats the exact duplicate message using the attempted block and lot', () => {
    expect(duplicateLotMessage(' Block A ', 12)).toBe('Block A, Lot 12 already has an active homeowner.')
    expect(duplicateLotMessage('B', 7)).toBe('Block B, Lot 7 already has an active homeowner.')
    expect(isDuplicateLotError({ code: '23505', message: 'duplicate key violates unique constraint "properties_one_active_homeowner_per_lot_idx"' })).toBe(true)
    expect(isDuplicateLotError({ code: '23505', message: 'duplicate key violates unique constraint "properties_pkey"' })).toBe(false)
  })
  it('uses the paid lot snapshot on the receipt for the same homeowner', () => {
    const organization = { formatMoney: String, formatDate: String }
    const receipts = lots.map((lot) => buildReceiptModel('payment', {
      homeowner_name: 'Same Owner', property_id: lot.id,
      block_name: lot.block, lot_number: lot.lot_number,
      amount_paid: '100.00', previous_balance: '100.00', remaining_balance: '0.00',
    }, organization))
    expect(receipts.map((receipt) => receipt.details.find((detail) => detail.label === 'Property').value))
      .toEqual(['Block A, Lot 12', 'Block B, Lot 7'])
  })
})
