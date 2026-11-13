import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Skeleton from '../components/skeleton/Skeleton'
import { supabase } from '../lib/supabaseClient'
import { compareActivityNewest, loadActivityMonth } from '../lib/activityArchive'
import ActivityArchiveStatus from '../components/ActivityArchiveStatus'
import Select from '../components/Select'
import DateField from '../components/DateField'
import { Activity, CreditCard, Users, Zap } from '../components/Icons'
import { staffActivityCopy, staffActionLabel, loadStaffActivityContext } from '../lib/staffActivityText'
import './ActivityLogPage.css'

const ZONE = 'Asia/Manila'
const dayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const timeFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
const fullFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: ZONE,
  dateStyle: 'full',
  timeStyle: 'short',
  hour12: true,
})
const groupFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})
const clockTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
const clockDate = new Intl.DateTimeFormat('en-PH', {
  timeZone: ZONE,
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})
const dateFull = new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, dateStyle: 'full' })
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const RANGE_LABELS = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  all: 'Selected month',
  custom: 'Custom',
}
const DEFAULT_RANGE = 'today'
const PAYMENT_RECORD_ACTIONS = new Set(['Payment Recorded', 'Service Payment Recorded', 'Service Balance Collected'])
function middleTruncate(value, limit) {
  const text = String(value)
  if (text.length <= limit) return text
  const extensionIndex = text.lastIndexOf('.')
  const extension = extensionIndex > 0 ? text.slice(extensionIndex) : ''
  const available = Math.max(limit - extension.length - 1, 2)
  const left = Math.ceil(available / 2)
  const right = Math.floor(available / 2)
  return `${text.slice(0, left)}…${extension ? text.slice(-right - extension.length, -extension.length) : text.slice(-right)}${extension}`
}

function actionIcon(action) {
  const value = String(action || '')
  const path = /payment|charge|expense|revenue/i.test(value) ? (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 14h3" />
    </>
  ) : /document/i.test(value) ? (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ) : /grievance/i.test(value) ? (
    <>
      <path d="M5 5h14v10H9l-4 4z" />
      <path d="M9 9h6M9 12h4" />
    </>
  ) : /homeowner|block|lot/i.test(value) ? (
    <>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </>
  ) : (
    <circle cx="12" cy="12" r="3" />
  )
  return (
    <svg
      className="al-action-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}
function dateKey(value = new Date()) {
  const parts = Object.fromEntries(
    dayFormat.formatToParts(value).map(({ type, value: part }) => [type, part]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}
function addDays(key, days) {
  const value = new Date(`${key}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
function shiftMonth(key, amount) {
  const [year, month] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7)
}
// Display-only parsing. Unknown action formats retain the complete original string.
const ACTIVITY_FIELD_LABELS = {
  price_per_sqm: 'Price per square meter',
}

function humanizeActivityFields(value) {
  return String(value).replace(
    /(^|; )([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?=:)/g,
    (_, prefix, key) =>
      prefix +
      (ACTIVITY_FIELD_LABELS[key] ||
        key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())),
  )
}

export function activityDisplay(log) {
  const raw = String(log.target || log.description || '')
  const actor = String(log.user || '').trim()
  const suffixPattern = actor
    ? new RegExp(` \\((?:by )?${actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`)
    : null
  const cleaned = suffixPattern ? raw.replace(suffixPattern, '') : raw
  const text = log.action === 'Settings Updated' ? humanizeActivityFields(cleaned) : cleaned
  const parts = text.split(' — ')
  const expected = {
    'Payment Recorded': 3,
    'Charge Added': 3,
    'Payment Voided': 4,
    'Charge Voided': 4,
    'Document Uploaded': 2,
    'Document Deleted': 2,
  }
  const moneyAction = /^(Payment Recorded|Charge Added|Payment Voided|Charge Voided)$/.test(log.action || '')
  const parsed =
    parts.length === expected[log.action] &&
    parts.every((part) => part.trim()) &&
    (!moneyAction || /^₱\s*-?[\d,]+(?:\.\d{1,2})?$/.test(parts[2]))
  const structuredAmount = typeof log.amount === 'number' && Number.isFinite(log.amount) ? log.amount : null
  const action = String(log.action || '')
  const expenseParts = /^(Expense Recorded|Expense Voided)$/.test(action) ? parts : null
  const grievanceMatch = /^Grievance (Recorded|Updated)$/.test(action)
    ? /^(GR-[\w-]+) - (.+) - (.+)$/.exec(text)
    : null
  const blockMatch = action === 'Block Added' ? /^[\w-]+$/.exec(text) : null
  const homeownerMatch = action === 'Homeowner Added' ? /^(.+) — (\S+), Lot (\S+)$/.exec(text) : null
  const documentMatch = /^(Document Uploaded|Document Deleted)$/.test(action) && parsed ? parts : null
  const expenseSubject = expenseParts?.[0]
  const expenseDetail = expenseParts
    ?.slice(1)
    .filter(
      (part, index) =>
        !(
          index === 0 && /^₱\s*-?[\d,]+(?:\.\d{1,2})?(?:\s+\([^)]*\))?(?:\s+\[Expense: [^\]]+\])?$/.test(part)
        ),
    )
    .join(' — ')
  const parsedSubject =
    expenseParts && expenseSubject
      ? expenseSubject
      : grievanceMatch
        ? grievanceMatch[1]
        : blockMatch
          ? `Block ${blockMatch[0]}`
          : homeownerMatch
            ? homeownerMatch[1]
            : documentMatch
              ? middleTruncate(documentMatch[0], 44)
              : parsed
                ? parts[0]
                : text
  const parsedDetail =
    expenseParts && expenseSubject
      ? expenseDetail
      : grievanceMatch
        ? `${grievanceMatch[2]} · ${grievanceMatch[3]}`
        : homeownerMatch
          ? `Block ${homeownerMatch[2]}, Lot ${homeownerMatch[3]}`
          : documentMatch
            ? ''
            : parsed
              ? parts
                  .slice(1)
                  .filter(
                    (part) => !/^₱\s*-?[\d,.]+$/.test(part) && part.replace(/\.[^.]+$/, '') !== parts[0],
                  )
                  .join(' — ')
              : ''
  const subject = documentMatch ? parsedSubject : log.subject || parsedSubject || 'Unknown record'

  // Format service audit descriptions without changing their stored text.
  const servicePayment =
    action === 'Service Payment Recorded' ? /^(SR-[\w-]+) — (.+) for (.+)$/.exec(text) : null

  const serviceBalance =
    action === 'Service Balance Collected'
      ? /^(SR-[\w-]+) — (₱\s*[\d,]+(?:\.\d{1,2})?) for (SR-[\w-]+) — (.+)$/.exec(text)
      : null

  const serviceVoid =
    action === 'Service Receipt Voided'
      ? /^(SR-[\w-]+) — (.+) for (.+) — (₱\s*[\d,]+(?:\.\d{1,2})?) — (.+)$/.exec(text)
      : null

  // Only read an amount from the known amount field. Notes and setting changes
  // can mention peso values without representing a transaction.
  const balanceAmount = /^Balance (Added|Voided)$/.test(action) ? /^(.+?) as of \d{4}-\d{2}-\d{2}/.exec(parts[2] || '')?.[1] : null
  const amountField = serviceBalance?.[2] || serviceVoid?.[4] || expenseParts?.[1] || balanceAmount
    || (parsed && moneyAction ? parts[2] : null)
  const money = /^₱\s*(-?\d[\d,]*(?:\.\d{1,2})?)(?:\s+\([^)]*\))?(?:\s+\[Expense: [^\]]+\])?$/.exec(amountField || '')
  const amount = structuredAmount ?? (money ? Number(money[1].replaceAll(',', '')) : null)

  const serviceSubject = servicePayment?.[1] || serviceBalance?.[1] || serviceVoid?.[1]

  const serviceDetail = servicePayment
    ? `${servicePayment[2]} · ${servicePayment[3]}`
    : serviceBalance
      ? `Balance payment for ${serviceBalance[3]} · ${serviceBalance[4]}`
      : serviceVoid
        ? `${serviceVoid[2]} · ${serviceVoid[3]} · Reason: ${serviceVoid[5]}`
        : null

  return {
    raw,
    text,
    subject: serviceSubject || subject,
    detail: serviceDetail ?? parsedDetail,
    amount,
    status: /fail|error/i.test(action)
      ? 'failed'
      : /\b(deleted|voided|cancelled|canceled|removed)\b/i.test(action)
        ? 'warning'
        : '',
  }
}

export function matchesActivitySearch(log, search) {
  const term = String(search || '')
    .trim()
    .toLowerCase()
  if (!term) return true
  const original = activityDisplay(log)
  const display = { ...original, ...staffActivityCopy(log, original, log.staffContext) }
  return (
    `${original.raw} ${original.text} ${display.action} ${log.user || ''} ${log.role || ''} ${log.action || ''} ${display.subject} ${display.detail}`
      .toLowerCase()
      .includes(term)
  )
}

export function summarizeActivity(logs) {
  const actors = new Map()
  const actions = new Map()
  let payments = 0
  for (const log of logs) {
    const actorId = log.user_id || 'system'
    const actor = actors.get(actorId) || { label: log.user || 'System', count: 0 }
    actor.count += 1
    actors.set(actorId, actor)
    const action = log.action || 'Other activity'
    actions.set(action, (actions.get(action) || 0) + 1)
    if (PAYMENT_RECORD_ACTIONS.has(action)) payments += 1
  }
  const mostActive = [...actors.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0]
  const topAction = [...actions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return {
    total: logs.length,
    mostActive: mostActive ? `${mostActive.label} (${mostActive.count})` : '—',
    topAction: topAction ? `${staffActionLabel(topAction[0])} (${topAction[1]})` : '—',
    payments,
  }
}

function HeaderClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className="al-clock" role="timer" aria-label="Current date and time">
      <time dateTime={now.toISOString()}>{clockTime.format(now)}</time>
      <span>{clockDate.format(now)}</span>
      <small>Philippine time</small>
    </div>
  )
}

function ActivityRow({ log, onOpen }) {
  const original = activityDisplay(log)
  const display = { ...original, ...staffActivityCopy(log, original, log.staffContext) }
  return (
    <li
      className={`al-entry ${display.status ? `al-${display.status}` : ''}`}
      data-id={log.id}
      onClick={() => onOpen(log.id)}
    >
      <div className="al-row">
        <div className="al-user">
          <strong>{log.user}</strong>
          <span>{log.role ? log.role.charAt(0).toUpperCase() + log.role.slice(1) : 'Role not recorded'}</span>
        </div>
        <div className="al-action">
          <span className="al-badge" title={display.action}>
            {actionIcon(log.action)}
            <span>{display.action}</span>
          </span>
        </div>
        <div className="al-summary">
          {display.status && (
            <span
              className="al-exception"
              role="img"
              aria-label={display.status === 'failed' ? 'Failed event' : 'Destructive action'}
            >
              {display.status === 'failed' ? '!' : '⚠'}
            </span>
          )}
          <div className="al-summary-text" title={display.text}>
            <strong>{display.subject}</strong>
            {display.detail && <span>{display.detail}</span>}
          </div>
        </div>
        <div className="al-amount">{display.amount !== null ? peso.format(display.amount) : null}</div>
        <time
          className="al-time"
          dateTime={log.created_at}
          title={fullFormat.format(new Date(log.created_at))}
        >
          {timeFormat.format(new Date(log.created_at))}
        </time>
        <button
          type="button"
          className="al-expand"
          data-expand-id={log.id}
          aria-haspopup="dialog"
          aria-label={`View ${display.action} details for ${log.user}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
    </li>
  )
}

const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || 'S'

// Centered details dialog. Browses the same filtered list as the page (Newer / Older, arrow keys).
function ActivityModal({ logs, id, onChange, onClose }) {
  const dialogRef = useRef(null)
  const index = logs.findIndex((log) => log.id === id)
  const log = logs[index]
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      document.documentElement.style.overflow = overflow
      const trigger = document.querySelector(`[data-expand-id="${CSS.escape(String(id))}"]`) || previous
      trigger?.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!log) onClose()
  }, [log, onClose])
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.parentElement.scrollTop = 0
    if (!dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true })
  }, [id])
  if (!log) return null
  const go = (direction) => {
    const next = logs[index + direction]
    if (next) onChange(next.id)
  }
  function keys(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      go(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      go(1)
    } else if (event.key === 'Tab') {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled)')]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialogRef.current)
      ) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
  const original = activityDisplay(log)
  const display = { ...original, ...staffActivityCopy(log, original, log.staffContext) }
  const time = new Date(log.created_at)

  return createPortal(
    <div
      className="al-modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className={`al-modal ${display.status || ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="al-modal-title"
        tabIndex={-1}
        onKeyDown={keys}
      >
        <div className="al-m-inner">
          <div className="al-m-head">
            <span className="al-m-badge">
              {actionIcon(log.action)}
              {display.action}
            </span>
            <button type="button" className="al-m-close" onClick={onClose} aria-label="Close details">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {display.status === 'failed' && (
            <div className="al-m-banner failed" role="note">
              This event failed.
            </div>
          )}
          {display.status === 'warning' && (
            <div className="al-m-banner warning" role="note">
              This action cancelled a transaction, deleted a document or removed a record. See the explanation below.
            </div>
          )}
          <div className="al-m-titlerow">
            <div>
              <h2 id="al-modal-title" className="al-m-subject">
                {display.subject}
              </h2>
            </div>
            {display.amount !== null && <div className="al-m-amount">{peso.format(display.amount)}</div>}
          </div>
          <div className="al-m-grid">
            <div className="al-m-card">
              <span className="al-m-label">Done by</span>
              <div className="al-m-who">
                <span className="al-m-avatar" aria-hidden="true">
                  {initials(log.user)}
                </span>
                <div>
                  <strong>{log.user}</strong>
                  <small>{log.role ? log.role.charAt(0).toUpperCase() + log.role.slice(1) : 'Role not recorded'}</small>
                </div>
              </div>
            </div>
            <div className="al-m-card">
              <span className="al-m-label">When</span>
              <strong>{timeFormat.format(time)}</strong>
              <small>{dateFull.format(time)}</small>
              {log.from_archive && <small>Archived record</small>}
            </div>

          </div>
          <div className="al-m-section">
            <h3>What happened</h3>
            <p className="al-m-text">{display.text || 'Unknown record'}</p>
          </div>

          <div className="al-m-foot">
            <button type="button" className="al-m-nav" onClick={() => go(-1)} disabled={index === 0}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
              Newer
            </button>
            <span className="al-m-count" aria-live="polite">
              {index + 1} of {logs.length}
              <small>Use ← → to browse, Esc to close</small>
            </span>
            <button
              type="button"
              className="al-m-nav"
              onClick={() => go(1)}
              disabled={index === logs.length - 1}
            >
              Older
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function ActivityLogPage() {
  const [today, setToday] = useState(dateKey())
  const [archiveMonth, setArchiveMonth] = useState(today.slice(0, 7))
  const [range, setRange] = useState(DEFAULT_RANGE)
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [user, setUser] = useState('')
  const [role, setRole] = useState('')
  const [action, setAction] = useState('')
  const [logs, setLogs] = useState([])
  const [loadedScope, setLoadedScope] = useState(null)
  const [error, setError] = useState('')
  const [profileWarning, setProfileWarning] = useState(false)
  const [limit, setLimit] = useState(25)
  const [revision, setRevision] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [openId, setOpenId] = useState(null)
  const panelRef = useRef(null)
  const filterButton = useRef(null)
  const toolbarRef = useRef(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const first =
    range === 'all'
      ? `${archiveMonth || today.slice(0, 7)}-01`
      : range === 'custom'
        ? start
        : addDays(today, range === 'week' ? -6 : range === 'month' ? -29 : 0)
  const last =
    range === 'all'
      ? addDays(`${shiftMonth(archiveMonth || today.slice(0, 7), 1)}-01`, -1)
      : range === 'custom'
        ? end
        : today
  // Read each requested month from the live table and verified private archives.
  // Each requested month is read separately; filters and 25-row disclosure are local.
  const firstMonth = first?.slice(0, 7)
  const lastMonth = last?.slice(0, 7)
  let dateError = ''
  if (range === 'custom') {
    if (!start || !end || start > end || end > today) {
      dateError = 'Choose a start and end date in order, through today.'
    } else if (lastMonth >= shiftMonth(firstMonth, 12)) {
      dateError = 'Choose up to 12 calendar months at a time.'
    }
  }
  const requestScope = dateError ? null : `${firstMonth}:${lastMonth}:${revision}`
  const loading = requestScope !== null && loadedScope !== requestScope
  const summariesAvailable = !loading && !error && !dateError

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const updateDay = () => setToday(dateKey())
    const timer = window.setInterval(updateDay, 60000)
    window.addEventListener('focus', updateDay)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', updateDay)
    }
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(() =>
      setToolbarHeight(toolbarRef.current?.getBoundingClientRect().height || 0),
    )
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!panelOpen) return undefined
    panelRef.current?.querySelector('.sel-trigger, input')?.focus()
    function close(event) {
      if (event.key === 'Escape') {
        setPanelOpen(false)
        filterButton.current?.focus()
      }
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [panelOpen])

  useEffect(() => {
    let cancelled = false
    async function loadActivityLogs() {
      if (requestScope === null) {
        setLogs([])
        setLoadedScope(null)
        setError('')
        setProfileWarning(false)
        return
      }
      setError('')
      setProfileWarning(false)
      try {
        const activityData = []
        for (
          let visibleMonth = firstMonth;
          visibleMonth <= lastMonth;
          visibleMonth = shiftMonth(visibleMonth, 1)
        ) {
          const { data: fetchedLogs, error: activityError } = await loadActivityMonth(supabase, visibleMonth)
          if (cancelled) return
          if (activityError) throw activityError
          activityData.push(...(fetchedLogs || []))
        }
        const userIds = [...new Set(activityData
          .filter((log) => !log.archived_actor?.name || log.archived_actor?.role == null)
          .map((log) => log.user_id).filter(Boolean))]
        const profileMap = new Map()
        for (let offset = 0; offset < userIds.length; offset += 100) {
          try {
            const { data: profiles, error: profileError } = await supabase
              .from('profiles')
              .select('id, full_name, email, role')
              .in('id', userIds.slice(offset, offset + 100))
            if (!profileError) {
              for (const profile of profiles || []) profileMap.set(profile.id, profile)
            }
          } catch {
            // Keep audit entries even when their staff profiles cannot be read.
          }
          if (cancelled) return
        }
        const staffContext = await loadStaffActivityContext(supabase, activityData)
        if (cancelled) return
        const prepared = activityData.map((log) => {
          const profile = profileMap.get(log.user_id)
          return {
            ...log,
            dateKey: dateKey(new Date(log.created_at)),
            staffContext,
            user: log.archived_actor?.name || profile?.full_name || profile?.email || (log.user_id ? 'Staff name unavailable' : 'System'),
            role: log.archived_actor?.role ?? profile?.role ?? '',
            description: log.target || log.description || '',
          }
        })
        prepared.sort(compareActivityNewest)
        setProfileWarning(userIds.some((id) => !profileMap.has(id)))
        setLogs(prepared)
      } catch (failure) {
        if (!cancelled) {
          setLogs([])
          setError(`Activity logs could not be loaded: ${failure.message || 'Please try again.'}`)
        }
      } finally {
        if (!cancelled) setLoadedScope(requestScope)
      }
    }
    loadActivityLogs()
    return () => {
      cancelled = true
    }
  }, [firstMonth, lastMonth, requestScope])

  const dateRows = useMemo(
    () => summariesAvailable ? logs.filter((log) => log.dateKey >= first && log.dateKey <= last) : [],
    [logs, first, last, summariesAvailable],
  )
  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    return dateRows.filter(
      (log) =>
        (!user || String(log.user_id || 'system') === user) &&
        (!role || log.role.toLowerCase() === role) &&
        (!action || log.action === action) &&
        matchesActivitySearch(log, term),
    )
  }, [dateRows, user, role, action, debouncedSearch])
  const activityStats = useMemo(() => summarizeActivity(filtered), [filtered])
  useEffect(() => {
    setLimit(25)
  }, [first, last, user, role, action, debouncedSearch, revision])
  const users = [...new Map(dateRows.map((log) => [String(log.user_id || 'system'), log.user])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  )
  const actions = [...new Set(dateRows.map((log) => log.action).filter(Boolean))].sort()
  if (user && !users.some(([id]) => id === user)) users.unshift([user, 'Selected user · no events in range'])
  if (action && !actions.includes(action)) actions.unshift(action)
  const chips = [
    search && {
      key: 'search',
      label: `Search: ${search}`,
      clear: () => {
        setSearch('')
        setDebouncedSearch('')
      },
    },
    user && {
      key: 'user',
      label: `User: ${users.find(([id]) => id === user)?.[1] || 'Unknown user'}`,
      clear: () => setUser(''),
    },
    role && { key: 'role', label: `Role: ${role}`, clear: () => setRole('') },
    action && { key: 'action', label: staffActionLabel(action), clear: () => setAction('') },
    range !== DEFAULT_RANGE && {
      key: 'date',
      label: range === 'custom' ? `${start || 'Start'} – ${end || 'End'}` : RANGE_LABELS[range],
      clear: () => setRange(DEFAULT_RANGE),
    },
    range === 'all' &&
      archiveMonth !== today.slice(0, 7) && {
        key: 'archive',
        label: archiveMonth,
        clear: () => setArchiveMonth(today.slice(0, 7)),
      },
  ].filter(Boolean)
  const closeModal = useCallback(() => setOpenId(null), [])
  function clearFilters() {
    setSearch('')
    setDebouncedSearch('')
    setUser('')
    setRole('')
    setAction('')
    setRange(DEFAULT_RANGE)
    setArchiveMonth(today.slice(0, 7))
    setStart(today)
    setEnd(today)
  }
  const groups = new Map()
  filtered.slice(0, limit).forEach((log) => {
    if (!groups.has(log.dateKey)) groups.set(log.dateKey, [])
    groups.get(log.dateKey).push(log)
  })
  const dateLabel = (key) =>
    key === today
      ? 'Today'
      : key === addDays(today, -1)
        ? 'Yesterday'
        : groupFormat.format(new Date(`${key}T00:00:00Z`))
  const select = (label, value, onChange, options) => (
    <label key={label}>
      <span className="al-sr-only">{label}</span>
      <Select
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={options.map(([key, name]) => ({ value: key, label: name }))}
      />
    </label>
  )

  return (
    <div className="activity-log-page" style={{ '--al-toolbar-height': `${toolbarHeight}px` }}>
      <header className="al-header">
        <div className="al-header-heading">
          <span className="al-header-icon" aria-hidden="true"><Activity size={28} /></span>
          <div className="al-header-copy">
            <h1>Activity Log</h1>
            <p>Search and review system activity across your team.</p>
          </div>
        </div>
        <HeaderClock />
      </header>
      <ActivityArchiveStatus onChanged={() => setRevision((value) => value + 1)} />
      <section className="al-stats-grid" aria-label="Activity summaries" aria-busy={loading}>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Total Events</span>
            <span className="al-stat-icon al-stat-icon-blue">
              <Activity size={18} />
            </span>
          </div>
          <strong>{summariesAvailable ? activityStats.total.toLocaleString('en-PH') : '—'}</strong>
          <small>Matching the current filters</small>
          <div className="al-stat-footer"><span aria-hidden="true" />Events matching current filters</div>
        </article>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Most Active User</span>
            <span className="al-stat-icon al-stat-icon-green">
              <Users size={18} />
            </span>
          </div>
          <strong className="al-stat-value-text">{summariesAvailable ? activityStats.mostActive : '—'}</strong>
          <small>Events in the selected range</small>
          <div className="al-stat-footer"><span aria-hidden="true" />User with the most matching events</div>
        </article>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Top Action</span>
            <span className="al-stat-icon al-stat-icon-blue">
              <Zap size={18} />
            </span>
          </div>
          <strong className="al-stat-value-text">{summariesAvailable ? activityStats.topAction : '—'}</strong>
          <small>Most common recorded action</small>
          <div className="al-stat-footer"><span aria-hidden="true" />Most frequent matching action</div>
        </article>
        <article className="al-stat-card">
          <div className="al-stat-top">
            <span>Payments Recorded</span>
            <span className="al-stat-icon al-stat-icon-green">
              <CreditCard size={18} />
            </span>
          </div>
          <strong>{summariesAvailable ? activityStats.payments.toLocaleString('en-PH') : '—'}</strong>
          <small>Regular and service payments recorded</small>
          <div className="al-stat-footer"><span aria-hidden="true" />Recorded payment activity</div>
        </article>
      </section>
      <section className="al-toolbar" ref={toolbarRef} aria-label="Activity controls">
        <div className="al-toolbar-main">
          <div className="al-search-row">
            <label className="al-search">
              <span className="al-sr-only">Search activity</span>
              <input
                type="search"
                aria-label="Search activity"
                placeholder="User, action, or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="al-filter-toggle"
              ref={filterButton}
              aria-expanded={panelOpen}
              aria-controls="activity-filters"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              Filters{chips.length ? ` (${chips.length})` : ''}
            </button>
            <button
              type="button"
              className="al-refresh"
              onClick={() => setRevision((value) => value + 1)}
              disabled={loading}
              aria-label="Refresh activity"
              title="Refresh"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 11a8.1 8.1 0 0 0-14.9-4.3L3 9" />
                <path d="M3 4v5h5" />
                <path d="M4 13a8.1 8.1 0 0 0 14.9 4.3L21 15" />
                <path d="M21 20v-5h-5" />
              </svg>
            </button>
          </div>
          <div id="activity-filters" ref={panelRef} className={`al-filters ${panelOpen ? 'al-open' : ''}`}>
            {select('User', user, setUser, [['', 'All users'], ...users])}
            {select('Role', role, setRole, [
              ['', 'All roles'],
              ['admin', 'Admin'],
              ['secretary', 'Secretary'],
              ['treasurer', 'Treasurer'],
            ])}
            {select('Action type', action, setAction, [
              ['', 'All actions'],
              ...actions.map((value) => [value, staffActionLabel(value)]),
            ])}
            {select('Date range', range, setRange, Object.entries(RANGE_LABELS))}
            {range === 'all' && (
              <label>
                Activity month
                <DateField
                  value={archiveMonth}
                  onChange={(value) => setArchiveMonth(value || today.slice(0, 7))}
                  max={today.slice(0, 7)}
                  ariaLabel="Activity month"
                  monthOnly
                />
              </label>
            )}
            {range === 'custom' && (
              <>
                <label>
                  From
                  <DateField value={start} max={end || today} onChange={setStart} ariaLabel="From date" />
                </label>
                <label>
                  Through
                  <DateField value={end} min={start} max={today} onChange={setEnd} ariaLabel="Through date" />
                </label>
              </>
            )}
            <button
              type="button"
              className="al-filter-done"
              onClick={() => {
                setPanelOpen(false)
                filterButton.current?.focus()
              }}
            >
              Done
            </button>
          </div>
        </div>
        {chips.length > 0 && (
          <div className="al-chips" aria-label="Active filters">
            {chips.map((chip) => (
              <button
                type="button"
                key={chip.key}
                onClick={chip.clear}
                aria-label={`Remove ${chip.label} filter`}
              >
                {chip.label}
                <span aria-hidden="true"> ×</span>
              </button>
            ))}
            <button type="button" className="al-clear" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        {dateError && <p role="alert">{dateError}</p>}
      </section>
      <section className="al-list" aria-label="Activity entries" aria-busy={loading}>
        <p className="al-result-count" role="status">
          {loading ? (
            <Skeleton variant="rect" width="120px" height="1em" />
          ) : dateError ? (
            'Date range needs attention'
          ) : error ? (
            'Activity unavailable'
          ) : (
            `${filtered.length.toLocaleString('en-PH')} results`
          )}
        </p>
        <div className="al-columns" aria-hidden="true">
          <span>User</span>
          <span>Action</span>
          <span>Summary</span>
          <span>Amount</span>
          <span>Time</span>
          <span />
        </div>
        {profileWarning && summariesAvailable && (
          <p className="al-notice" role="status">
            Some staff details could not be found. Their activity is still shown; unavailable names and roles are labelled clearly.
          </p>
        )}
        {loading ? (
          <div role="status" aria-label="Loading activity">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="al-skeleton" key={index} aria-hidden="true">
                <Skeleton variant="rect" width="100%" height="1em" />
                <Skeleton variant="rect" width="100%" height="1em" />
                <Skeleton variant="rect" width="100%" height="1em" />
                <Skeleton variant="rect" width="100%" height="1em" />
                <Skeleton variant="rect" width="100%" height="1em" />
                <Skeleton variant="rect" width="24px" height="1em" />
              </div>
            ))}
          </div>
        ) : dateError ? null : error ? (
          <div className="al-state" role="alert">
            <h2>Unable to load activity</h2>
            <p>{error}</p>
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="al-state">
            <h2>
              {chips.length
                ? 'No matching activity'
                : range === DEFAULT_RANGE
                  ? 'No activity today'
                  : 'No activity yet'}
            </h2>
            <p>
              {chips.length
                ? 'Try another search or date range.'
                : range === DEFAULT_RANGE
                  ? 'Activity recorded today will appear here. Choose Last 7 days to see earlier entries.'
                  : 'Recorded activity will appear here for the selected month.'}
            </p>
            {chips.length > 0 && (
              <button type="button" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          [...groups.entries()].map(([key, entries]) => (
            <section key={key} aria-label={dateLabel(key)}>
              <h2 className="al-date">{dateLabel(key)}</h2>
              <ul>
                {entries.map((log) => (
                  <ActivityRow key={log.id} log={log} onOpen={setOpenId} />
                ))}
              </ul>
            </section>
          ))
        )}
        {openId !== null && (
          <ActivityModal logs={filtered} id={openId} onChange={setOpenId} onClose={closeModal} />
        )}
        {summariesAvailable && (
          <footer className="al-footer">
            <span role="status">
              Showing {Math.min(limit, filtered.length)} of {filtered.length.toLocaleString('en-PH')}
            </span>
            {limit < filtered.length && (
              <button type="button" onClick={() => setLimit((value) => value + 25)}>
                Load more
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  )
}
