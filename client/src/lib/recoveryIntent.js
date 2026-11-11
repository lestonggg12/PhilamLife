// Recovery state is only a UI gate. Supabase verifies the recovery token server-side.
const KEY = 'philam-recovery-intent'
const TTL_MS = 10 * 60 * 1000

export function markRecoveryIntent(userId) {
  if (!userId) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ userId, expiresAt: Date.now() + TTL_MS }))
  } catch { /* Storage unavailable: fail closed. */ }
}

export function hasValidRecoveryIntent(userId) {
  if (!userId) return false
  try {
    const intent = JSON.parse(sessionStorage.getItem(KEY) || 'null')
    return intent?.userId === userId && Number.isFinite(intent.expiresAt) && Date.now() < intent.expiresAt
  } catch { return false }
}

export function clearRecoveryIntent() {
  try { sessionStorage.removeItem(KEY) } catch { /* Storage unavailable */ }
}
