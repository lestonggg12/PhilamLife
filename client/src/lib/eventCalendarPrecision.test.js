import { describe, expect, it } from 'vitest'
import { preserveCalendarTimePrecision } from './eventCalendar'

describe('Event Calendar time editing', () => {
  it('preserves seconds when changing an hour, minute or AM/PM', () => {
    expect(preserveCalendarTimePrecision('10:15:05', '11:15')).toBe('11:15:05')
    expect(preserveCalendarTimePrecision('10:15:05.123456', '22:20')).toBe('22:20:05.123456')
  })

  it('preserves explicit zero seconds and respects minute-only times', () => {
    expect(preserveCalendarTimePrecision('10:00:00', '09:45')).toBe('09:45:00')
    expect(preserveCalendarTimePrecision('10:00', '09:45')).toBe('09:45')
    expect(preserveCalendarTimePrecision('', '08:30')).toBe('08:30')
  })

  it('rejects malformed hour/minute values rather than producing an invalid time', () => {
    expect(() => preserveCalendarTimePrecision('10:00:00', 'bad')).toThrow('valid hour and minute')
  })
})
