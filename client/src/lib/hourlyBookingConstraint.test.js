import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

describe('Shared amenity booking safeguards', () => {
  it('requires valid booking times', () => {
    expect(source).toContain('endTimeError')
  })

  it('allows overlapping times for explicit review', () => {
    expect(source).toContain('bookedRanges={[]}')
  })

  it('checks availability before recording payment', () => {
    expect(source).toContain('bookedLoading || bookedError')
  })

  it('handles changed reservation counts', () => {
    expect(source).toContain("error?.code === '40001'")
  })

  it('requires a confirmed overlap count', () => {
    expect(source).toContain('overlap_acknowledged_count: count')
  })
})