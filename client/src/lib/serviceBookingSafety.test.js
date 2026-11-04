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

describe('Amenity booking turnover safety', () => {
  it('blocks saving when availability cannot be verified', () => {
    expect(serviceSource).toMatch(
      /async function saveTransaction[\s\S]*?if \(bookedLoading \|\| bookedError\)/,
    )
  })

  it('checks booked time ranges before recording a receipt', () => {
    expect(serviceSource).toContain(
      'bookedRanges.some((range) => {',
    )
    expect(serviceSource).toContain(
      'rangesOverlap(start, end, bookedStart, bookedEnd)',
    )
  })

  it('disables saving while the booking check is loading or failed', () => {
    expect(serviceSource).toMatch(
      /disabled=\{saving \|\| bookedLoading \|\| Boolean\(bookedError\)/,
    )
  })

  it('clearly identifies the amount paid on an individual receipt', () => {
    expect(revenueSource).toContain('Paid (Receipt)')
    expect(revenueSource).toContain(
      'later balance collections appear as separate receipts',
    )
  })
})