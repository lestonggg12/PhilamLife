import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const serviceSource = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

const revenueSource = readFileSync(
  new URL('../pages/TreasurerServiceRevenuePage.jsx', import.meta.url),
  'utf8',
)

describe('Shared amenity booking safety', () => {
  it('blocks saving when availability cannot be verified', () => {
    expect(serviceSource).toContain('bookedLoading || bookedError')
  })

  it('checks the actual number of overlapping reservations', () => {
    expect(serviceSource).toContain("count: 'exact'")
    expect(serviceSource).toContain(".lt('start_time', payload.end_time)")
    expect(serviceSource).toContain(".gt('end_time', payload.start_time)")
  })

  it('requires confirmation before recording overlapping payments', () => {
    expect(serviceSource).toContain('window.confirm(')
    expect(serviceSource).toContain('if (!accepted) return')
  })

  it('sends the acknowledged count to the database', () => {
    expect(serviceSource).toContain('overlap_acknowledged_count: count')
  })

  it('keeps the receipt payment amount clearly labeled', () => {
    expect(revenueSource).toContain('Paid (Receipt)')
  })
})