import { describe, expect, it } from 'vitest'
import { matchesHomeownerSearch } from './homeownerDirectory'

describe('homeowner directory search', () => {
  const lot = { homeowner_name: 'Lily Reyes', block: 'Block 3', lot_number: 12, contact_email: 'lily@example.test' }
  it('matches words across the name, block and lot', () => {
    expect(matchesHomeownerSearch(lot, 'LILY block 3, lot 12')).toBe(true)
    expect(matchesHomeownerSearch(lot, 'Lily Block 4')).toBe(false)
  })
  it('retains contact searches and handles missing fields', () => {
    expect(matchesHomeownerSearch(lot, 'lily@example.test')).toBe(true)
    expect(matchesHomeownerSearch({}, '')).toBe(true)
    expect(matchesHomeownerSearch({}, 'Lily')).toBe(false)
  })
})
