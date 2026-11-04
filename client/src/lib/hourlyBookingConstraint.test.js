import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

describe('Hourly amenity booking protection', () => {
  it('requires a time range for hourly services', () => {
    expect(source).toContain('hourlySlotRequired')
    expect(source).toContain(
      'Select a start and end time for hourly amenities.',
    )
  })

  it('checks overlapping bookings before saving', () => {
    expect(source).toContain(
      'rangesOverlap(start, end, bookedStart, bookedEnd)',
    )
  })

  it('handles PostgreSQL exclusion constraint errors', () => {
    expect(source).toContain("error?.code === '23P01'")
  })

  it('refreshes booking availability after a conflict', () => {
    expect(source).toMatch(
      /error\?\.code === '23P01'[\s\S]*?setReloadTick/,
    )
  })

  it('does not require exclusive slots for per-person services', () => {
    expect(source).toContain(
      "String(bookingService.rate_unit || '').trim().toLowerCase() !== 'per hour'",
    )
  })
})