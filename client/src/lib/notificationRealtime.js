// Subscribe only to the append-only staff event tables. Personal read receipts
// remain private; they are not published to Realtime.
let channelSequence = 0

export function mergeLiveNotification(current, row) {
  if (!row || !['id', 'title', 'body', 'kind', 'created_at'].every((key) => typeof row[key] === 'string') ||
      !Number.isFinite(Date.parse(row.created_at)) || current.items.some((item) => item.id === row.id)) return current
  const items = [{ ...row, read: false }, ...current.items]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, 20)
  return { items, unread: current.unread + 1 }
}

export function watchStaffInserts(db, { table, propertyId, onInsert, refresh }) {
  if (!['notifications', 'account_activity'].includes(table)) throw new Error('Unsupported staff event table.')
  if (table === 'account_activity' && !/^[1-9]\d*$/.test(String(propertyId))) throw new Error('A property account is required.')
  let disposed = false
  let running = false
  let queued = false
  let channel

  // Start immediately. Events received during a fetch cause one more fetch,
  // so a burst cannot leave the last event hidden behind an older response.
  const reconcile = async () => {
    if (disposed) return
    queued = true
    if (running) return
    running = true
    try {
      while (queued && !disposed) {
        queued = false
        try { await refresh() } catch { /* The component displays fetch errors; polling remains available. */ }
      }
    } finally { running = false }
  }
  const inserted = (payload) => {
    if (disposed) return
    try { onInsert?.(payload.new) } finally { void reconcile() }
  }
  try {
    channel = db.channel(`staff-events:${table}:${Date.now()}:${++channelSequence}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table,
        ...(table === 'account_activity' ? { filter: `property_id=eq.${propertyId}` } : {}),
      }, inserted)
      .subscribe((status) => {
        // Also runs after reconnect, recovering any missed events and closing
        // the gap between the initial HTTP read and subscription readiness.
        if (status === 'SUBSCRIBED') void reconcile()
      })
  } catch {
    // A setup/network failure must not break the existing focus/poll fallback.
  }
  return () => {
    disposed = true
    if (channel) {
      try { Promise.resolve(db.removeChannel(channel)).catch(() => {}) } catch { /* Already removed. */ }
    }
  }
}
