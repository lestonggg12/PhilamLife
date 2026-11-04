import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../pages/ServicesManagementPage.jsx', import.meta.url), 'utf8')

describe('Shared amenity booking integration contracts', () => {
  it('shows available overlapping times without changing the reusable picker', () => {
    expect(source.match(/bookedRanges=\{\[\]\}/g)).toHaveLength(2)
    expect(source).not.toContain('Drop an already-chosen time that clashes')
  })
  it('reads a fresh scoped overlap count before recording payment', () => {
    expect(source).toContain(".select('id', { count: 'exact', head: true })")
    expect(source).toContain(".is('balance_of', null)")
    expect(source).toContain(".neq('payment_status', 'voided')")
    expect(source).toContain(".lt('start_time', payload.end_time)")
    expect(source).toContain(".gt('end_time', payload.start_time)")
  })
  it('requires explicit confirmation and sends the count to the DB trigger', () => {
    expect(source).toContain('window.confirm(')
    expect(source).toContain('if (!accepted) return')
    expect(source).toContain('overlap_acknowledged_count: count')
  })
  it('handles stale occupancy and server-enforced capacity', () => {
    expect(source).toContain("error?.code === '40001'")
    expect(source).toContain("error?.code === '23514'")
  })
  it('supports Secretary-defined limits but does not change the default', () => {
    expect(source).toContain('shared_booking_limit: 1')
    expect(source).toContain('shared_booking_limit: Number(serviceForm.shared_booking_limit)')
    expect(source).toContain('Maximum simultaneous reservations')
  })
})