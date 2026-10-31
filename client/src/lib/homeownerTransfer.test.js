import { describe, expect, it } from 'vitest'
import { transferChoices, transferRequest } from './homeownerTransfer'
const previous = { id: 1, homeowner_id: 'owner-a' }
const lots = [
  { id: 1, homeowner_id: 'owner-a', homeowner_name: 'Same Name', homeowner_status: 'active', block: 'Block A', lot_number: 1 },
  { id: 2, homeowner_id: 'owner-b', homeowner_name: 'Same Name', homeowner_status: 'active', block: 'Block B', lot_number: 2 },
  { id: 3, homeowner_id: 'owner-b', homeowner_name: 'Same Name', homeowner_status: 'active', block: 'Block C', lot_number: 3 },
  { id: 4, homeowner_id: 'owner-c', homeowner_name: 'Same Name', homeowner_status: 'active', block: 'Block D', lot_number: 4 },
  { id: 5, homeowner_id: 'owner-d', homeowner_name: 'Moved', homeowner_status: 'moved' },
]
describe('explicit homeowner transfers', () => {
  it('groups by identity, keeps equal names separate, and excludes the current owner and historical lots', () => {
    const choices = transferChoices(lots, previous)
    expect(choices.map((p) => p.homeowner_id)).toEqual(['owner-b', 'owner-c'])
    expect(choices[0].lots).toEqual(['Block B, Lot 2', 'Block C, Lot 3'])
  })
  it('sends the selected property ID rather than a name for an existing homeowner', () => {
    expect(transferRequest(1, { transferTo: 'existing', targetProperty: lots[1], effectiveDate: '2026-10-31', reason: ' approved ', newHomeownerName: 'Ignored' })).toEqual({
      name: 'transfer_homeowner_to_existing', args: { p_previous_property_id: 1, p_target_property_id: 2, p_effective_date: '2026-10-31', p_note: 'approved' },
    })
  })
  it('requires an explicit existing-homeowner selection', () => {
    expect(() => transferRequest(1, { transferTo: 'existing', targetProperty: null, reason: '' })).toThrow('Select an existing homeowner')
  })
  it('preserves the original RPC for a new homeowner, even when names match', () => {
    expect(transferRequest(1, { transferTo: 'new', newHomeownerName: ' Same Name ', reason: '', effectiveDate: '2026-10-31' })).toMatchObject({ name: 'transfer_homeowner', args: { p_new_homeowner_name: 'Same Name', p_note: null } })
  })
})
