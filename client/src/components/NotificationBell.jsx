import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Bell, CalendarClock, Coins, TriangleAlert, Ban, UserRound, Settings } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { fetchSystemNotifications, markAllNotificationsRead, markNotificationsRead,
  notificationLink, popoverPosition, relativeManilaTime, unreadBadge, NOTIFICATION_LIMIT, isCurrentNotification } from '../lib/systemNotifications'
import { mergeLiveNotification, watchStaffInserts } from '../lib/notificationRealtime'
import { staffNotificationCopy } from '../lib/staffActivityText'
import './NotificationBell.css'

const icons = { collection_reminder: CalendarClock, collection_run: Coins, penalty_anniversary: TriangleAlert, transaction_voided: Ban, ownership_changed: UserRound, settings_changed: Settings, credit_applied: Coins, penalty_applied: TriangleAlert, monthly_balance_added: Coins, penalty_collected: Coins }

export default function NotificationBell({ user }) {
  const navigate = useNavigate()
  const panelId = useId()
  const trigger = useRef(null)
  const panel = useRef(null)
  const generation = useRef(0)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ items: [], unread: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [position, setPosition] = useState({})
  const enabled = ['admin', 'secretary', 'treasurer'].includes(user?.role) && !!user?.id

  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const next = await fetchSystemNotifications(supabase)
      if (request === generation.current) { setData(next); setError('') }
    } catch {
      if (request === generation.current) setError('Notifications could not be refreshed. Please retry.')
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setOpen(false)
    setData({ items: [], unread: 0 })
    setLoading(true)
    if (!enabled) return
    const stopRealtime = watchStaffInserts(supabase, {
      table: 'notifications',
      onInsert: (row) => {
        generation.current++
        setData((current) => mergeLiveNotification(current, row))
      },
      refresh,
    })
    void refresh()
    const interval = window.setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => {
      generation.current++
      stopRealtime()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
    }
  }, [enabled, user?.id, refresh])

  useEffect(() => {
    if (!enabled) return
    const expiries = data.items.map((item) => Date.parse(item.expires_at)).filter(Number.isFinite)
    if (!expiries.length) return
    const delay = Math.max(1, Math.min(2147483647, Math.min(...expiries) - Date.now() + 1))
    const timer = window.setTimeout(() => {
      setData((current) => ({ ...current, items: current.items.filter((item) => isCurrentNotification(item)) }))
      void refresh()
    }, delay)
    return () => window.clearTimeout(timer)
  }, [data.items, enabled, refresh])

  useLayoutEffect(() => {
    if (!open) return
    const reposition = () => setPosition(popoverPosition(trigger.current.getBoundingClientRect(), {
      width: window.innerWidth, height: window.innerHeight,
    }))
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    const outside = (event) => {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    const key = (event) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    panel.current?.focus()
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const mark = async (item) => {
    if (busy) return
    if (!isCurrentNotification(item)) { void refresh(); return }
    setBusy(true)
    try {
      await markNotificationsRead(supabase, user.id, [item.id])
      setOpen(false)
      navigate(notificationLink(item.link, user.role))
      await refresh()
    } catch { setError('Could not mark this notification as read. Please retry.') }
    finally { setBusy(false) }
  }
  const markAll = async () => {
    setBusy(true)
    try { await markAllNotificationsRead(supabase, user.id); await refresh() }
    catch { setError('Could not mark all notifications as read. Please retry.') }
    finally { setBusy(false) }
  }

  if (!enabled) return null
  return <>
    <button type="button" ref={trigger} className="notification-bell motion-interactive"
      aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`}
      aria-expanded={open} aria-controls={open ? panelId : undefined} aria-haspopup="dialog"
      onClick={() => setOpen((value) => !value)}>
      <Bell size={19} aria-hidden="true" />
      {data.unread > 0 && <span className="notification-badge">{unreadBadge(data.unread)}</span>}
    </button>
    {open && createPortal(<section id={panelId} ref={panel} tabIndex={-1} role="dialog"
      aria-label="System notifications" className="notification-panel motion-page-enter" style={position}>
      <header><h2>Notifications</h2><button type="button" disabled={busy || !data.unread} onClick={markAll}>Mark all as read</button>
        <button type="button" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus() }}>×</button></header>
      {error && <div className="notification-error" role="alert">{error} <button type="button" onClick={refresh}>Retry</button></div>}
      {loading ? <div aria-busy="true" aria-label="Loading notifications">{[1, 2, 3].map((key) => <div key={key} className="notification-skeleton" />)}</div>
        : !data.items.length ? <div className="notification-empty"><Bell size={26} /><p>{error ? 'Notifications are unavailable.' : 'You’re all caught up.'}</p><small>Collection reminders, account activity, voids, and settings updates appear here.</small></div>
          : <ul>{data.items.slice(0, NOTIFICATION_LIMIT).map((item) => {
            const copy = staffNotificationCopy(item)
            const Icon = icons[item.kind] || Bell
            return <li key={item.id} className={item.read ? '' : 'notification-unread'}>
              <button type="button" className="notification-item" disabled={busy} onClick={() => mark(item)}>
                <Icon className="notification-kind" size={19} aria-hidden="true" />
                <span className="notification-copy"><strong>{copy.title}</strong><span className="notification-body">{copy.body}</span>
                  <time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', timeZoneName: 'short' })}>{relativeManilaTime(item.created_at)}</time></span>
                {!item.read && <span className="notification-dot" aria-label="Unread" />}
              </button>
              <details className="notification-details"><summary>View details{item.payload?.top_accounts?.length ? ' and largest accounts' : ''}</summary>
                <p>{copy.body}</p>
                {item.payload?.actor_name && <small>Recorded by {item.payload.actor_name}</small>}
                {!!copy.related.length && <ul>{copy.related.map((description, index) => <li key={index}>{description}</li>)}</ul>}
                {item.payload?.observed_on && <small>Account information checked on {item.payload.observed_on} (Philippine time).</small>}
                {item.payload?.top_accounts?.map((account) => <div className="notification-account" key={account.property_id}>
                  <span>{account.name}<small>{String(account.block).match(/block/i) ? account.block : `Block ${account.block}`}  · Lot {account.lot_number}</small></span><strong>{account.amount_formatted}</strong>
                </div>)}
              </details>
            </li>
          })}</ul>}
    </section>, document.body)}
  </>
}
