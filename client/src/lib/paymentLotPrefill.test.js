import { describe, expect, it } from 'vitest'
import { findActivePaymentLot, paymentLotFields } from './paymentLotPrefill'

const lots = [
  { id: 27, homeowner_name: 'Lily', block: 'Block 3', lot_number: 4, current_balance: '200.00', homeowner_status: 'active' },
  { id: 29, homeowner_name: 'Lily', block: 'Block 3', lot_number: 12, current_balance: '0.00', homeowner_status: 'active' },
  { id: 30, homeowner_name: 'Lily', block: 'Block 3', lot_number: 12, current_balance: '500.00', homeowner_status: 'transferred' },
  { id: 31, homeowner_name: 'Lily', block: 'Block 3', lot_number: 5, current_balance: '500.00', homeowner_status: 'moved' },
]

describe('Record Payment from a homeowner profile', () => {
  it('selects the exact lot even when several lots share a homeowner name', () => {
    const selected = findActivePaymentLot(lots, '29')
    expect(paymentLotFields(selected)).toEqual({ propertyId: '29', homeownerName: 'Lily', blockName: 'Block 3', lotNumber: '12', previousBalance: '0.00' })
    expect(paymentLotFields(findActivePaymentLot(lots, 27)).previousBalance).toBe('200.00')
  })
  it('rejects moved, transferred, missing, and empty lot requests', () => {
    for (const id of [30, 31, 999, '', null, undefined]) {
      expect(findActivePaymentLot(lots, id)).toBeNull()
    }
  })
  it('preserves exact decimal balances and advance credit without float conversion', () => {
    expect(paymentLotFields({ ...lots[0], current_balance: '-51333.34' }).previousBalance).toBe('-51333.34')
    expect(paymentLotFields({ ...lots[0], current_balance: '9999999999.99' }).previousBalance).toBe('9999999999.99')
  })
  it('preserves legacy active status and handles a missing balance', () => {
    const legacy = { ...lots[0], homeowner_status: null, current_balance: null }
    expect(findActivePaymentLot([legacy], '27')).toBe(legacy)
    expect(paymentLotFields(legacy).previousBalance).toBe('0')
  })
})
