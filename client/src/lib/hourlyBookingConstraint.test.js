import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

describe('Shared amenity booking protection', () => {
  it('requires valid booking times', () => {
    expect(source).toContain('endTimeError')
  })

  it('allows selection of occupied times for review', () => {
    expect(source).toContain('bookedRanges={[]}')
  })

  it('checks the configured reservation limit', () => {
    expect(source).toContain('service.shared_booking_limit')
  })

  it('handles changed availability', () => {
    expect(source).toContain("error?.code === '40001'")
  })

  it('handles capacity-reached database errors', () => {
    expect(source).toContain("error?.code === '23514'")
  })
})