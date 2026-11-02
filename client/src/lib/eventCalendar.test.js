import { describe, expect, it, vi } from 'vitest'
import { calendarToday, isCalendarDate, calendarMonthDays, shiftCalendarMonth, calendarFormValues, validateCalendarForm, loadCalendarEvents, saveCalendarEvent, deleteCalendarEvent } from './eventCalendar'
const actor = { id: 'secretary-fixture', full_name: 'Fixture Secretary' }
const id = 'calendar-fixture'
const existing = { id, updated_at: '2026-11-02T01:00:00.123456Z' }
const form = { title: 'Assembly', eventDate: '2026-11-02', startTime: '10:00', endTime: '11:00', location: 'Hall', description: 'Agenda' }
const payload = validateCalendarForm(form).payload
function client(results) {
  const chain = { select: vi.fn(() => chain), order: vi.fn(() => chain), eq: vi.fn(() => chain), insert: vi.fn(() => chain), update: vi.fn(() => chain), delete: vi.fn(() => chain), single: vi.fn(), maybeSingle: vi.fn() }
  const queue = [...results]
  const next = async () => { const item = queue.shift(); if (item instanceof Error) throw item; return item }
  chain.single.mockImplementation(next); chain.maybeSingle.mockImplementation(next)
  return { from: vi.fn(() => chain), chain }
}
describe('Calendar dates and round-trip values', () => {
  it('uses Manila midnight independently of host timezone', () => {
    expect(calendarToday(new Date('2026-11-01T15:59:59Z'))).toBe('2026-11-01')
    expect(calendarToday(new Date('2026-11-01T16:00:00Z'))).toBe('2026-11-02')
  })
  it.each(['2026-02-29','infinity','0000-01-01','10000-01-01','2026-13-01','2026-02-30',''])('rejects unsupported date %s', (date) => expect(isCalendarDate(date)).toBe(false))
  it('accepts a real leap day and retains a 42-day grid across year boundaries', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(calendarMonthDays('2026-11')).toHaveLength(42)
    expect(calendarMonthDays('2026-11')[0].key).toBe('2026-11-01')
    expect(shiftCalendarMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftCalendarMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftCalendarMonth('0001-01', -1)).toBe('0001-01')
    expect(shiftCalendarMonth('9999-12', 1)).toBe('9999-12')
  })
  it('does not map year 0001 into 1901', () => {
    expect(calendarMonthDays('0001-01').some((day) => day.key === '0001-01-01')).toBe(true)
  })
  it('retains seconds and description newlines when editing another field', () => {
    const original = { title: 'Assembly', event_date: '2026-11-02', start_time: '10:00:05.123456', end_time: '10:00:30', description: 'First item\nSecond item', location: 'Hall' }
    const value = validateCalendarForm(calendarFormValues(original))
    expect(value.error).toBeUndefined()
    expect(value.payload).toMatchObject({ start_time: original.start_time, end_time: original.end_time, description: original.description })
    expect(value.payload).not.toHaveProperty('updated_at')
  })
  it.each([
    [{ title: '' }, 'title'], [{ title: 'x'.repeat(161) }, '160'], [{ location: 'x'.repeat(161) }, '160'],
    [{ description: 'x'.repeat(1001) }, '1,000'], [{ endTime: '09:59' }, 'later'], [{ endTime: '10:00:00' }, 'later'],
    [{ startTime: '', endTime: '11:00' }, 'start'], [{ startTime: '25:00' }, 'valid event time'], [{ startTime: '10:60' }, 'valid event time'],
  ])('validates %j', (change, message) => expect(validateCalendarForm({ ...form, ...change }).error).toContain(message))
})
describe('Confirmed calendar mutations', () => {
  it('confirms update and delete using the exact loaded version token', async () => {
    const c = client([{ data: existing, error: null }, { data: { id }, error: null }])
    await saveCalendarEvent(c, payload, existing, actor)
    await deleteCalendarEvent(c, existing)
    expect(c.chain.eq.mock.calls).toEqual([['id', id], ['updated_at', existing.updated_at], ['id', id], ['updated_at', existing.updated_at]])
  })
  it.each([null, { id: 'other' }])('rejects an unconfirmed delete: %j', async (data) => {
    await expect(deleteCalendarEvent(client([{ data, error: null }]), existing)).rejects.toThrow('No event was deleted')
  })
  it('reports a stale/RLS no-op instead of success', async () => {
    const c = client([{ data: null, error: { code: 'PGRST116', message: 'Zero rows' } }])
    await expect(saveCalendarEvent(c, payload, existing, actor)).rejects.toThrow('Refresh')
  })
  it('propagates mutation errors and thrown network failures', async () => {
    const error = { code: '42501', message: 'Secretary required' }
    await expect(deleteCalendarEvent(client([{ data: null, error }]), existing)).rejects.toBe(error)
    await expect(saveCalendarEvent(client([new Error('Offline')]), payload, existing, actor)).rejects.toThrow('Offline')
  })
  it('rejects missing version tokens before sending a mutation', async () => {
    const c = client([])
    await expect(deleteCalendarEvent(c, { id })).rejects.toThrow('Refresh')
    await expect(saveCalendarEvent(c, payload, { id }, actor)).rejects.toThrow('Refresh')
    expect(c.from).not.toHaveBeenCalled()
  })
  it('schedules under the stable form attempt ID', async () => {
    const c = client([{ data: { ...existing, ...payload }, error: null }])
    await saveCalendarEvent(c, payload, null, actor, id)
    expect(c.chain.insert).toHaveBeenCalledWith({ ...payload, id, created_by: actor.id, created_by_name: actor.full_name })
  })
  it('recovers a matching creation after an uncertain network response without a new ID', async () => {
    const saved = { ...payload, ...existing, created_by: actor.id, start_time: '10:00:00', end_time: '11:00:00' }
    const c = client([new Error('Connection lost'), { data: null, error: { code: '23505' } }, { data: saved, error: null }])
    await expect(saveCalendarEvent(c, payload, null, actor, id)).rejects.toThrow('Connection lost')
    expect(await saveCalendarEvent(c, payload, null, actor, id)).toEqual(saved)
    expect(c.chain.insert.mock.calls.every(([row]) => row.id === id)).toBe(true)
  })
  it('never treats another actor or changed event as the same creation', async () => {
    for (const row of [{ ...payload, id, created_by: 'other' }, { ...payload, id, created_by: actor.id, title: 'Changed' }]) {
      await expect(saveCalendarEvent(client([{ data: null, error: { code: '23505' } }, { data: row, error: null }]), payload, null, actor, id)).rejects.toThrow('Refresh')
    }
  })
})
describe('Calendar reads', () => {
  it('checks SDK errors and thrown network failures', async () => {
    for (const result of [{ data: null, error: { message: 'Denied' } }, new Error('Offline')]) {
      const chain = { select() { return this }, order() { return this }, async range() { if (result instanceof Error) throw result; return result } }
      await expect(loadCalendarEvents({ from: () => chain })).rejects.toBeTruthy()
    }
  })
  it('reads beyond the API cap and rejects unsupported source dates', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ id, event_date: '2026-11-02' }))
    const make = (data) => ({ from: () => ({ select() { return this }, order() { return this }, async range(a, b) { return { data: data.slice(a, b + 1), error: null } } }) })
    expect(await loadCalendarEvents(make(rows))).toHaveLength(1001)
    await expect(loadCalendarEvents(make([{ event_date: 'infinity' }]))).rejects.toThrow('unsupported date')
  })
})
