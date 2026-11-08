import { describe, expect, it, vi } from 'vitest'
import { mergeLiveNotification, watchStaffInserts } from './notificationRealtime'

function fixture() {
  let inserted, status
  const channel = {
    on: vi.fn((_type, _filter, callback) => { inserted = callback; return channel }),
    subscribe: vi.fn((callback) => { status = callback; return channel }),
  }
  return {
    channel: vi.fn(() => channel), removeChannel: vi.fn().mockResolvedValue('ok'), stream: channel,
    insert: (row) => inserted({ new: row }), status: (value) => status(value),
  }
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('staff realtime delivery', () => {
  it('refreshes immediately on a database insert without waiting for a timer', () => {
    const db = fixture(), refresh = vi.fn().mockResolvedValue(), onInsert = vi.fn()
    watchStaffInserts(db, { table: 'notifications', onInsert, refresh })
    db.insert({ id: 'new-event' })
    expect(onInsert).toHaveBeenCalledWith({ id: 'new-event' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(db.stream.on).toHaveBeenCalledWith('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, expect.any(Function))
  })
  it('catches up when the subscription connects or reconnects', async () => {
    const db = fixture(), refresh = vi.fn().mockResolvedValue()
    watchStaffInserts(db, { table: 'notifications', refresh })
    db.status('SUBSCRIBED'); await settle()
    db.status('CHANNEL_ERROR'); await settle()
    db.status('SUBSCRIBED'); await settle()
    expect(refresh).toHaveBeenCalledTimes(2)
  })
  it('filters activity by the selected property and uses unique channel names', () => {
    const db = fixture()
    watchStaffInserts(db, { table: 'account_activity', propertyId: 1133, refresh: vi.fn() })
    watchStaffInserts(db, { table: 'account_activity', propertyId: 1133, refresh: vi.fn() })
    expect(db.stream.on.mock.calls[0][1]).toMatchObject({ filter: 'property_id=eq.1133' })
    expect(db.channel.mock.calls[0][0]).not.toBe(db.channel.mock.calls[1][0])
  })
  it('reconciles a burst after the current fetch, preserving its last event', async () => {
    let finish
    const db = fixture(), refresh = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValue()
    watchStaffInserts(db, { table: 'notifications', refresh })
    db.insert({ id: 'one' }); db.insert({ id: 'two' }); db.insert({ id: 'three' })
    expect(refresh).toHaveBeenCalledTimes(1)
    finish(); await settle()
    expect(refresh).toHaveBeenCalledTimes(2)
  })
  it('unsubscribes and ignores events after logout, unmount, or account change', () => {
    const db = fixture(), refresh = vi.fn(), onInsert = vi.fn()
    const stop = watchStaffInserts(db, { table: 'notifications', refresh, onInsert })
    stop(); db.insert({ id: 'late' }); db.status('SUBSCRIBED')
    expect(db.removeChannel).toHaveBeenCalledWith(db.stream)
    expect(refresh).not.toHaveBeenCalled(); expect(onInsert).not.toHaveBeenCalled()
  })
  it('does not execute queued work after cleanup', async () => {
    let finish
    const db = fixture(), refresh = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const stop = watchStaffInserts(db, { table: 'notifications', refresh })
    db.insert({ id: 'one' }); db.insert({ id: 'two' }); stop(); finish(); await settle()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('leaves polling usable if channel setup fails', () => {
    expect(() => watchStaffInserts({ channel: () => { throw new Error('offline') } }, { table: 'notifications', refresh: vi.fn() })()).not.toThrow()
  })
  it('never subscribes to private read receipts or money tables', () => {
    for (const table of ['notification_reads','payments','properties']) {
      expect(() => watchStaffInserts(fixture(), { table, refresh: vi.fn() })).toThrow('Unsupported')
    }
    expect(() => watchStaffInserts(fixture(), { table: 'account_activity', refresh: vi.fn() })).toThrow('property')
  })
})
describe('instant bell rendering', () => {
  const row = { id: 'new', kind: 'settings_changed', title: 'Settings updated', body: 'price per sqm: ₱5.00 → ₱4.00', created_at: '2026-11-08T10:00:00Z' }
  it('shows the incoming unread notification before the HTTP reconciliation completes', () => {
    const state = mergeLiveNotification({ items: [], unread: 0 }, row)
    expect(state.unread).toBe(1)
    expect(state.items[0]).toMatchObject({ ...row, read: false })
  })
  it('does not double-count a duplicate websocket event', () => {
    const state = mergeLiveNotification({ items: [], unread: 0 }, row)
    expect(mergeLiveNotification(state, row)).toBe(state)
  })
  it('keeps the newest twenty while counting unread across the history', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ ...row, id: `old-${i}`, created_at: '2026-11-07T10:00:00Z', read: false }))
    const state = mergeLiveNotification({ items, unread: 25 }, row)
    expect(state.items).toHaveLength(20); expect(state.unread).toBe(26); expect(state.items[0].id).toBe('new')
  })
  it('ignores malformed payloads so the server read can recover', () => {
    const state = { items: [], unread: 0 }
    expect(mergeLiveNotification(state, { id: 'bad' })).toBe(state)
    expect(mergeLiveNotification(state, { ...row, created_at: 'invalid' })).toBe(state)
  })
})
