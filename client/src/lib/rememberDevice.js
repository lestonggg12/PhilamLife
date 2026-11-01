export const REMEMBER_PREFERENCE_KEY = 'philam-auth-persistence'
export const REMEMBER_DEADLINE_KEY = 'philam-auth-remembered-session'
export const REMEMBER_CHANGED_EVENT = 'philam-remembered-session-changed'
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short' })

// Seven complete weekday intervals, at the same Manila time of day. Weekends
// are skipped; holidays are not tracked by this application.
export function rememberedUntil(start) {
  const date = new Date(start)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid sign-in date')
  let days = 0
  while (days < 7) {
    date.setUTCDate(date.getUTCDate() + 1)
    if (!['Sat', 'Sun'].includes(weekday.format(date))) days += 1
  }
  return date.getTime()
}

export function createRememberedDevice({ local, session, authKey, now = () => Date.now(), changed = () => {} }) {
  const isSessionKey = (key) => key === authKey || key === `${authKey}-user`
  const mode = () => local.getItem(REMEMBER_PREFERENCE_KEY) === 'local' ? 'local' : 'session'
  function readDeadline() {
    try {
      const record = JSON.parse(local.getItem(REMEMBER_DEADLINE_KEY) || 'null')
      if (record?.version !== 1 || !Number.isFinite(record.startedAt) || !Number.isFinite(record.expiresAt)
        || record.expiresAt !== rememberedUntil(record.startedAt) || now() < record.startedAt) return null
      return record
    } catch { return null }
  }
  function hasExpired() {
    try { return mode() === 'local' && (!readDeadline() || now() >= readDeadline().expiresAt) }
    catch { return true }
  }
  function discardSession() {
    for (const key of [authKey, `${authKey}-user`]) {
      local.removeItem(key)
      session.removeItem(key)
    }
  }
  function setPreference(remember) {
    // A fresh credential attempt starts a new window. Old tokens cannot be
    // revived by merely switching storage mode or by a failed login.
    discardSession()
    session.removeItem(REMEMBER_PREFERENCE_KEY)
    if (remember) {
      const startedAt = now()
      local.setItem(REMEMBER_DEADLINE_KEY, JSON.stringify({ version: 1, startedAt, expiresAt: rememberedUntil(startedAt) }))
      local.setItem(REMEMBER_PREFERENCE_KEY, 'local')
    } else {
      local.removeItem(REMEMBER_DEADLINE_KEY)
      local.setItem(REMEMBER_PREFERENCE_KEY, 'session')
    }
    changed()
  }
  function clearPreference() {
    discardSession()
    local.removeItem(REMEMBER_PREFERENCE_KEY)
    local.removeItem(REMEMBER_DEADLINE_KEY)
    session.removeItem(REMEMBER_PREFERENCE_KEY)
    changed()
  }
  const storage = {
    getItem(key) {
      if (isSessionKey(key) && hasExpired()) { discardSession(); return null }
      // PKCE is a temporary recovery verifier, not a remembered sign-in.
      if (key.endsWith('-code-verifier')) return session.getItem(key) ?? local.getItem(key)
      const target = mode() === 'local' ? local : session
      // In particular, unchecked Remember me never restores a local token.
      return target.getItem(key)
    },
    setItem(key, value) {
      if (isSessionKey(key) && hasExpired()) { discardSession(); return }
      const target = key.endsWith('-code-verifier') || mode() !== 'local' ? session : local
      const other = target === local ? session : local
      target.setItem(key, value)
      other.removeItem(key)
      // Token rotation deliberately does not update the fixed deadline.
    },
    removeItem(key) { local.removeItem(key); session.removeItem(key) },
  }
  function prepareRecovery() {
    if (mode() === 'local') {
      // Preserve PKCE and allow a fresh emailed recovery session to be stored
      // temporarily, even when an older remembered session has expired.
      discardSession()
      local.removeItem(REMEMBER_DEADLINE_KEY)
      local.setItem(REMEMBER_PREFERENCE_KEY, 'session')
    }
  }
  return {
    storage, setPreference, clearPreference, hasExpired, discardSession, prepareRecovery,
    expiresAt: () => mode() === 'local' ? readDeadline()?.expiresAt ?? 0 : null,
    isEnabled: () => mode() === 'local' && !hasExpired(),
  }
}

export function watchRememberedDevice(device, onExpired) {
  let timer
  let disposed = false
  let fired = false
  function check() {
    clearTimeout(timer)
    if (disposed) return
    if (device.hasExpired()) {
      if (!fired) { fired = true; onExpired() }
      return
    }
    fired = false
    const deadline = device.expiresAt()
    if (deadline) timer = setTimeout(check, Math.min(Math.max(deadline - Date.now(), 1), 60_000))
  }
  const events = ['focus', 'pageshow', 'storage', REMEMBER_CHANGED_EVENT]
  events.forEach((event) => window.addEventListener(event, check))
  document.addEventListener('visibilitychange', check)
  check()
  return () => {
    disposed = true
    clearTimeout(timer)
    events.forEach((event) => window.removeEventListener(event, check))
    document.removeEventListener('visibilitychange', check)
  }
}
