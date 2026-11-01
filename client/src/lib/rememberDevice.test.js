import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRememberedDevice, rememberedUntil, watchRememberedDevice, REMEMBER_PREFERENCE_KEY as PREF, REMEMBER_DEADLINE_KEY as META, REMEMBER_CHANGED_EVENT } from './rememberDevice'

const KEY = 'sb-fixture-auth-token'
function memoryStorage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }
}
function fixture(start = '2026-11-02T02:00:00Z') {
  let time = Date.parse(start)
  const local = memoryStorage(), session = memoryStorage(), changed = vi.fn()
  const device = createRememberedDevice({ local, session, authKey: KEY, now: () => time, changed })
  return { device, local, session, changed, at: (value) => { time = typeof value === 'string' ? Date.parse(value) : value } }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('seven Manila working days', () => {
  it.each([
    ['2026-11-02T02:00:00Z', '2026-11-11T02:00:00Z'],
    ['2026-11-06T02:00:00Z', '2026-11-17T02:00:00Z'],
    ['2026-11-01T02:00:00Z', '2026-11-10T02:00:00Z'],
    ['2026-11-07T02:00:00Z', '2026-11-17T02:00:00Z'],
    // Friday UTC is already Saturday in Manila; count local weekdays.
    ['2026-11-06T17:00:00Z', '2026-11-16T17:00:00Z'],
  ])('expires %s at %s', (start, end) => {
    expect(new Date(rememberedUntil(Date.parse(start))).toISOString()).toBe(end.replace('Z', '.000Z'))
  })
  it('rejects invalid dates', () => expect(() => rememberedUntil(NaN)).toThrow('Invalid sign-in date'))
})

describe('bounded remembered-device storage', () => {
  it('persists a checked sign-in through a simulated browser restart', () => {
    const f = fixture(); f.device.setPreference(true); f.device.storage.setItem(KEY, 'fixture session')
    const reopened = createRememberedDevice({ local: f.local, session: memoryStorage(), authKey: KEY, now: () => Date.parse('2026-11-10T02:00:00Z') })
    expect(reopened.storage.getItem(KEY)).toBe('fixture session')
    expect(reopened.isEnabled()).toBe(true)
  })
  it('does not extend the deadline on token rotation', () => {
    const f = fixture(); f.device.setPreference(true)
    const initial = f.local.getItem(META)
    f.at('2026-11-10T02:00:00Z'); f.device.storage.setItem(KEY, 'refreshed fixture session')
    expect(f.local.getItem(META)).toBe(initial)
    expect(f.device.storage.getItem(KEY)).toBe('refreshed fixture session')
  })
  it('expires at the exact deadline and removes both copies plus cached user data', () => {
    const f = fixture(); f.device.setPreference(true)
    f.device.storage.setItem(KEY, 'fixture session'); f.local.setItem(`${KEY}-user`, 'fixture user'); f.session.setItem(KEY, 'stale fixture')
    f.at('2026-11-11T01:59:59.999Z'); expect(f.device.hasExpired()).toBe(false)
    f.at('2026-11-11T02:00:00Z'); expect(f.device.storage.getItem(KEY)).toBeNull()
    expect(f.local.getItem(KEY)).toBeNull(); expect(f.session.getItem(KEY)).toBeNull(); expect(f.local.getItem(`${KEY}-user`)).toBeNull()
    expect(f.device.hasExpired()).toBe(true)
  })
  it('refuses a late refresh write after expiration', () => {
    const f = fixture(); f.device.setPreference(true); f.at('2026-11-11T02:00:00Z')
    f.device.storage.setItem(KEY, 'late refreshed fixture')
    expect(f.local.getItem(KEY)).toBeNull(); expect(f.session.getItem(KEY)).toBeNull()
    expect(f.device.hasExpired()).toBe(true)
  })
  it('keeps unchecked sign-ins in this tab and never falls back to local tokens', () => {
    const f = fixture(); f.local.setItem(KEY, 'old remembered fixture')
    f.device.setPreference(false); f.device.storage.setItem(KEY, 'temporary fixture')
    expect(f.local.getItem(KEY)).toBeNull(); expect(f.session.getItem(KEY)).toBe('temporary fixture')
    const reopened = createRememberedDevice({ local: f.local, session: memoryStorage(), authKey: KEY })
    expect(reopened.storage.getItem(KEY)).toBeNull()
    f.local.setItem(KEY, 'stray persistent fixture'); expect(reopened.storage.getItem(KEY)).toBeNull()
  })
  it('defaults to temporary storage when no preference exists', () => {
    const f = fixture(); f.device.storage.setItem(KEY, 'temporary fixture')
    expect(f.local.getItem(KEY)).toBeNull(); expect(f.session.getItem(KEY)).toBe('temporary fixture')
  })
  it.each([null, '{}', '{broken', '{"version":1,"startedAt":0,"expiresAt":9999999999999}'])('requires credentials for legacy or invalid deadlines: %j', (metadata) => {
    const f = fixture(); f.local.setItem(PREF, 'local'); f.local.setItem(KEY, 'legacy fixture')
    if (metadata !== null) f.local.setItem(META, metadata)
    expect(f.device.hasExpired()).toBe(true); expect(f.device.storage.getItem(KEY)).toBeNull()
  })
  it('fails closed when the clock moves before the recorded sign-in', () => {
    const f = fixture(); f.device.setPreference(true); f.at('2026-11-01T02:00:00Z')
    expect(f.device.hasExpired()).toBe(true)
  })
  it('fresh credentials start a new window while clearing the previous session', () => {
    const f = fixture(); f.device.setPreference(true); f.device.storage.setItem(KEY, 'old fixture')
    f.at('2026-11-12T02:00:00Z'); f.device.setPreference(true)
    expect(f.device.storage.getItem(KEY)).toBeNull(); expect(f.device.hasExpired()).toBe(false)
    expect(f.device.expiresAt()).toBe(rememberedUntil(Date.parse('2026-11-12T02:00:00Z')))
  })
  it('clearing a failed attempt or manual logout clears persistence and session', () => {
    const f = fixture(); f.device.setPreference(true); f.device.storage.setItem(KEY, 'fixture session')
    f.device.clearPreference()
    expect(f.local.getItem(KEY)).toBeNull(); expect(f.session.getItem(KEY)).toBeNull()
    expect(f.local.getItem(META)).toBeNull(); expect(f.local.getItem(PREF)).toBeNull()
  })
  it('never clears another project storage key', () => {
    const f = fixture(); f.local.setItem('sb-another-auth-token', 'other project fixture')
    f.device.setPreference(true); f.device.clearPreference()
    expect(f.local.getItem('sb-another-auth-token')).toBe('other project fixture')
  })
  it('permits temporary recovery after expiry and preserves the PKCE verifier', () => {
    const f = fixture(); f.device.setPreference(true); f.device.storage.setItem(KEY, 'old fixture')
    f.local.setItem(`${KEY}-code-verifier`, 'legacy PKCE fixture'); f.at('2026-11-12T02:00:00Z')
    f.device.prepareRecovery(); expect(f.device.hasExpired()).toBe(false)
    expect(f.device.storage.getItem(`${KEY}-code-verifier`)).toBe('legacy PKCE fixture')
    f.device.storage.setItem(KEY, 'temporary recovery fixture')
    expect(f.session.getItem(KEY)).toBe('temporary recovery fixture'); expect(f.local.getItem(KEY)).toBeNull()
    f.device.prepareRecovery(); expect(f.device.storage.getItem(KEY)).toBe('temporary recovery fixture')
  })
  it('keeps new PKCE verifiers temporary and removable', () => {
    const f = fixture(); f.device.setPreference(true)
    f.device.storage.setItem(`${KEY}-code-verifier`, 'PKCE fixture')
    expect(f.session.getItem(`${KEY}-code-verifier`)).toBe('PKCE fixture')
    f.device.storage.removeItem(`${KEY}-code-verifier`); expect(f.session.getItem(`${KEY}-code-verifier`)).toBeNull()
  })
})

describe('open-tab expiry watcher', () => {
  function browserFixture() {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T02:00:00Z'))
    const windowEvents = new EventTarget(), documentEvents = new EventTarget()
    vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents)
    const local = memoryStorage(), session = memoryStorage()
    const device = createRememberedDevice({ local, session, authKey: KEY })
    device.setPreference(true)
    return { device, local, windowEvents, documentEvents }
  }
  it('expires an active tab exactly at its deadline', async () => {
    const f = browserFixture(); vi.setSystemTime(new Date(f.device.expiresAt() - 10))
    const expired = vi.fn(); const cleanup = watchRememberedDevice(f.device, expired)
    await vi.advanceTimersByTimeAsync(9); expect(expired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(expired).toHaveBeenCalledOnce(); cleanup()
  })
  it.each(['focus', 'pageshow', 'storage', REMEMBER_CHANGED_EVENT])('checks a suspended/cross-tab session on %s', (event) => {
    const f = browserFixture(), expired = vi.fn(), cleanup = watchRememberedDevice(f.device, expired)
    vi.setSystemTime(new Date(f.device.expiresAt() + 1)); f.windowEvents.dispatchEvent(new Event(event))
    f.windowEvents.dispatchEvent(new Event(event)); expect(expired).toHaveBeenCalledOnce(); cleanup()
  })
  it('checks visibility changes and removes listeners/timers on cleanup', () => {
    const f = browserFixture(), expired = vi.fn(), cleanup = watchRememberedDevice(f.device, expired)
    cleanup(); vi.setSystemTime(new Date(f.device.expiresAt() + 1)); f.documentEvents.dispatchEvent(new Event('visibilitychange'))
    expect(expired).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not expire a temporary unchecked sign-in', async () => {
    const f = browserFixture(); f.device.setPreference(false)
    const expired = vi.fn(), cleanup = watchRememberedDevice(f.device, expired)
    await vi.advanceTimersByTimeAsync(20 * 86400000); expect(expired).not.toHaveBeenCalled(); cleanup()
  })
})
