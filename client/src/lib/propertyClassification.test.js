import { describe, it, expect } from 'vitest'
import {
  CLASSIFICATIONS,
  canClassifyProperty,
  classificationLabel,
  validateClassificationChange,
  manilaToday,
} from './propertyClassification'

describe('property classification contract', () => {
  it('keeps Unclassified as a distinct value', () => {
    expect(CLASSIFICATIONS.map((entry) => entry.value)).toEqual(['unclassified','lot_owner','homeowner'])
    expect(classificationLabel('lot_owner')).toContain('Lot Owner')
  })
  it('limits editing to Admin and Secretary', () => {
    expect(canClassifyProperty('admin')).toBe(true)
    expect(canClassifyProperty('secretary')).toBe(true)
    expect(canClassifyProperty('treasurer')).toBe(false)
    expect(canClassifyProperty('')).toBe(false)
  })
  it('checks Manila day even around UTC date boundary', () => {
    expect(manilaToday(new Date('2026-11-04T18:00:00Z'))).toBe('2026-11-05')
  })
  it('requires reason, a changed status and current effective date', () => {
    const good = {current:'unclassified',next:'lot_owner',reason:'Verified vacant lot',effectiveFrom:'2026-11-05',today:'2026-11-05'}
    expect(validateClassificationChange(good)).toBe('')
    expect(validateClassificationChange({...good,reason:'no'})).toMatch(/reason/)
    expect(validateClassificationChange({...good,next:'unclassified'})).toMatch(/different/)
    expect(validateClassificationChange({...good,effectiveFrom:'2026-11-04'})).toMatch(/today/)
  })
})
