import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

describe('Unlimited shared amenity booking', () => {
  it('allows occupied times to be selected', () => {
    expect(source.match(/bookedRanges=\{\[\]\}/g)).toHaveLength(2)
  })

  it('checks existing overlapping reservations', () => {
    expect(source).toContain("count: 'exact'")
    expect(source).toContain(".is('balance_of', null)")
    expect(source).toContain(".neq('payment_status', 'voided')")
    expect(source).toContain(".lt('start_time', payload.end_time)")
    expect(source).toContain(".gt('end_time', payload.start_time)")
  })

  it('requires confirmation for existing reservations', () => {
    expect(source).toContain('<ActionDialog')
    expect(source).toContain('bookingConfirmationResolver.current = resolve')
    expect(source).toContain('if (!accepted) return')
    expect(source).not.toContain('window.confirm(')
    expect(source).toContain('overlap_acknowledged_count: count')
  })

  it('handles changed availability', () => {
    expect(source).toContain("error?.code === '40001'")
  })

  it('does not apply a maximum reservation capacity', () => {
    expect(source).not.toContain('shared_booking_limit')
    expect(source).not.toContain('Maximum simultaneous reservations')
    expect(source).not.toContain('Booking capacity reached')
  })
})