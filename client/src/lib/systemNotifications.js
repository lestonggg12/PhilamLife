// All amounts and account totals are supplied and formatted by Postgres.
export const NOTIFICATION_LINK = '/overdue-accounts'
export const unreadBadge = (count) => count > 9 ? '9+' : String(count)
export function notificationLink(link, role) {
  if (link === '/system-settings') return role === 'admin' ? link : '/activity-log'
  if ([NOTIFICATION_LINK, '/activity-log', '/expenses'].includes(link) || /^\/homeowners\/[1-9]\d*$/.test(String(link))) return link
  return NOTIFICATION_LINK
}

export function relativeManilaTime(value, now = Date.now()) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date(timestamp))
}

export function popoverPosition(anchor, viewport, height = 480) {
  const gap = 8
  const width = Math.min(400, viewport.width - gap * 2)
  const below = viewport.height - anchor.bottom - gap * 2
  const above = anchor.top - gap * 2
  const flipped = below < Math.min(height, 240) && above > below
  const maxHeight = Math.max(0, flipped ? above : below)
  return {
    left: Math.max(gap, Math.min(anchor.right - width, viewport.width - width - gap)),
    width, maxHeight,
    ...(flipped ? { bottom: viewport.height - anchor.top + gap } : { top: anchor.bottom + gap }),
  }
}

const unreadQuery = (db) => db.from('notifications')
  .select('id, notification_reads!left(notification_id)', { count: 'exact' })
  .is('notification_reads', null)

export async function fetchSystemNotifications(db) {
  const [latest, unread] = await Promise.all([
    db.from('notifications').select('*, notification_reads(notification_id)')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20),
    unreadQuery(db).limit(0),
  ])
  if (latest.error) throw latest.error
  if (unread.error) throw unread.error
  return {
    items: (latest.data || []).map((item) => ({ ...item, read: item.notification_reads?.length > 0 })),
    unread: unread.count || 0,
  }
}

export async function markNotificationsRead(db, userId, ids) {
  if (!userId || !ids.length) return
  const { error } = await db.from('notification_reads').upsert(
    ids.map((id) => ({ notification_id: id, user_id: userId })),
    { onConflict: 'notification_id,user_id', ignoreDuplicates: true },
  )
  if (error) throw error
}

export async function markAllNotificationsRead(db, userId) {
  if (!userId) throw new Error('A staff account is required.')
  // Bound the operation to notifications that existed when the user clicked.
  const boundary = new Date().toISOString()
  while (true) {
    const { data, error } = await unreadQuery(db).lte('created_at', boundary).limit(200)
    if (error) throw error
    if (!data?.length) return
    await markNotificationsRead(db, userId, data.map(({ id }) => id))
  }
}
