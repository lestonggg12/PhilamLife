const listeners = new Set()
let nextId = 0

export function subscribeActionFeedback(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifySuccess(message) {
  return notifyAction(message, 'success')
}

export function notifyAction(message, tone = 'success') {
  const text = String(message ?? '').trim()
  if (!text) return
  const notice = { id: ++nextId, message: text, tone }
  listeners.forEach((listener) => listener(notice))
  return notice.id
}
