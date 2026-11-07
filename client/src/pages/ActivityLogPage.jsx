import React, { useEffect, useMemo, useRef, useState } from 'react'
import Skeleton from '../components/skeleton/Skeleton'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import Select from '../components/Select'
import DateField from '../components/DateField'
import { Activity, CreditCard, Users, Zap } from '../components/Icons'
import './ActivityLogPage.css'

const ZONE = 'Asia/Manila'
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: true })
const fullFormat = new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, dateStyle: 'full', timeStyle: 'long', hour12: true })
const groupFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const RANGE_LABELS = { today: 'Today', week: 'Last 7 days', month: 'Last 30 days', all: 'Selected month', custom: 'Custom' }
const DEFAULT_RANGE = 'today'
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
  const path = /payment|charge|expense|revenue/i.test(value)
    ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 14h3" /></>
    : /document/i.test(value)
      ? <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>
      : /grievance/i.test(value)
        ? <><path d="M5 5h14v10H9l-4 4z" /><path d="M9 9h6M9 12h4" /></>
        : /homeowner|block|lot/i.test(value)
          ? <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>
          : <circle cx="12" cy="12" r="3" />
  return <svg className="al-action-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
}
function dateKey(value = new Date()) {
  const parts = Object.fromEntries(dayFormat.formatToParts(value).map(({ type, value: part }) => [type, part]))
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
function boundary(month) { return new Date(`${month}-01T00:00:00+08:00`).toISOString() }

// Display-only parsing. Unknown action formats retain the complete original string.
const ACTIVITY_FIELD_LABELS = {
  price_per_sqm: 'Price per square meter',
}

function humanizeActivityFields(value) {
  return String(value).replace(/(^|; )([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?=:)/g, (_, prefix, key) => (
    prefix + (ACTIVITY_FIELD_LABELS[key] || key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))
  ))
}

export function activityDisplay(log) {
  const raw = String(log.target || log.description || '')
  const actor = String(log.user || '').trim()
  const suffixPattern = actor ? new RegExp(` \\((?:by )?${actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`) : null
  const cleaned = suffixPattern ? raw.replace(suffixPattern, '') : raw
  const text = log.action === 'Settings Updated' ? humanizeActivityFields(cleaned) : cleaned
  const parts = text.split(' — ')
  const expected = { 'Payment Recorded': 3, 'Charge Added': 3, 'Payment Voided': 4, 'Charge Voided': 4, 'Document Uploaded': 2, 'Document Deleted': 2 }
  const moneyAction = /^(Payment Recorded|Charge Added|Payment Voided|Charge Voided)$/.test(log.action || '')
  const parsed = parts.length === expected[log.action] && parts.every((part) => part.trim()) && (!moneyAction || /^₱\s*-?[\d,]+(?:\.\d{1,2})?$/.test(parts[2]))
  const money = text.match(/₱\s*(-?\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/)
  const structuredAmount = typeof log.amount === 'number' && Number.isFinite(log.amount) ? log.amount : null
  const amount = structuredAmount ?? (money ? Number(money[1].replaceAll(',', '')) : null)
  const action = String(log.action || '')
  const expenseParts = /^(Expense Recorded|Expense Voided)$/.test(action) ? parts : null
  const grievanceMatch = /^Grievance (Recorded|Updated)$/.test(action) ? /^(GR-[\w-]+) - (.+) - (.+)$/.exec(text) : null
  const blockMatch = action === 'Block Added' ? /^[\w-]+$/.exec(text) : null
  const homeownerMatch = action === 'Homeowner Added' ? /^(.+) — (\S+), Lot (\S+)$/.exec(text) : null
  const documentMatch = /^(Document Uploaded|Document Deleted)$/.test(action) && parsed ? parts : null
  const expenseSubject = expenseParts?.[0]
  const expenseDetail = expenseParts?.slice(1).filter((part, index) => !(index === 0 && /^₱\s*-?[\d,]+(?:\.\d{1,2})?(?:\s+\([^)]*\))?(?:\s+\[Expense: [^\]]+\])?$/.test(part))).join(' — ')
  const parsedSubject = expenseParts && expenseSubject
    ? expenseSubject
    : grievanceMatch
      ? grievanceMatch[1]
      : blockMatch
        ? `Block ${blockMatch[0]}`
        : homeownerMatch
          ? homeownerMatch[1]
          : documentMatch
            ? middleTruncate(documentMatch[0], 44)
            : parsed ? parts[0] : text
  const parsedDetail = expenseParts && expenseSubject
    ? expenseDetail
    : grievanceMatch
      ? `${grievanceMatch[2]} · ${grievanceMatch[3]}`
      : homeownerMatch
        ? `Block ${homeownerMatch[2]}, Lot ${homeownerMatch[3]}`
        : documentMatch
          ? ''
          : parsed ? parts.slice(1).filter((part) => !/^₱\s*-?[\d,.]+$/.test(part) && part.replace(/\.[^.]+$/, '') !== parts[0]).join(' — ') : ''
  const subject = documentMatch ? parsedSubject : (log.subject || parsedSubject || 'Unknown record')

  // Format service audit descriptions without changing their stored text.
  const servicePayment = action === 'Service Payment Recorded'
    ? /^(SR-[\w-]+) — (.+) for (.+)$/.exec(text)
    : null

  const serviceBalance = action === 'Service Balance Collected'
    ? /^(SR-[\w-]+) — (₱\s*[\d,]+(?:\.\d{1,2})?) for (SR-[\w-]+) — (.+)$/.exec(text)
    : null

  const serviceVoid = action === 'Service Receipt Voided'
    ? /^(SR-[\w-]+) — (.+) for (.+) — (₱\s*[\d,]+(?:\.\d{1,2})?) — (.+)$/.exec(text)
    : null

  const serviceSubject = servicePayment?.[1]
    || serviceBalance?.[1]
    || serviceVoid?.[1]

  const serviceDetail = servicePayment
    ? `${servicePayment[2]} · ${servicePayment[3]}`
    : serviceBalance
      ? `Balance payment for ${serviceBalance[3]} · ${serviceBalance[4]}`
      : serviceVoid
        ? `${serviceVoid[2]} · ${serviceVoid[3]} · Reason: ${serviceVoid[5]}`
        : null

  return {
    raw, text,
    subject: serviceSubject || subject,
    detail: serviceDetail ?? parsedDetail,
    amount,
    status: /fail|error/i.test(action) ? 'failed' : /\b(deleted|voided|cancelled|canceled|removed)\b/i.test(action) ? 'warning' : '',
  }
}

export function matchesActivitySearch(log, search) {
  const term = String(search || '').trim().toLowerCase()
  const display = activityDisplay(log)
  return !term || `${log.user || ''} ${log.action || ''} ${display.raw} ${display.text} ${display.subject} ${display.detail}`.toLowerCase().includes(term)
}

function ActivityRow({ log }) {
  const [expanded, setExpanded] = useState(false)
  const display = activityDisplay(log)
  const detailsId = `activity-details-${log.id}`
  const metadata = log.metadata && typeof log.metadata === 'object' ? Object.entries(log.metadata) : []
  return (
    <li className={`al-entry ${display.status ? `al-${display.status}` : ''}`}>
      <div className="al-row">
        <div className="al-user"><strong>{log.user}</strong><span>{log.role || 'Unknown role'}</span></div>
        <div className="al-action"><span className="al-badge" title={log.action || 'Activity'}>{actionIcon(log.action)}<span>{log.action || 'Activity'}</span></span></div>
        <div className="al-summary">
          {display.status && <span className="al-exception" role="img" aria-label={display.status === 'failed' ? 'Failed event' : 'Destructive action'}>{display.status === 'failed' ? '!' : '⚠'}</span>}
          <div className="al-summary-text" title={display.text}><strong>{display.subject}</strong>{display.detail && <span>{display.detail}</span>}</div>
        </div>
        <div className="al-amount">{display.amount !== null ? peso.format(display.amount) : null}</div>
        <time className="al-time" dateTime={log.created_at} title={fullFormat.format(new Date(log.created_at))}>{timeFormat.format(new Date(log.created_at))}</time>
        <button type="button" className="al-expand" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${log.action || 'activity'} details for ${log.user}`} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'}</button>
      </div>
      {expanded && <dl id={detailsId} className="al-details">
        <dt>Description</dt><dd>{display.text || 'Unknown record'}</dd>
        {display.raw !== display.text && <><dt>Original description</dt><dd>{display.raw}</dd></>}
        <dt>User</dt><dd>{log.user} · {log.role || 'Unknown role'}</dd>
        <dt>Recorded</dt><dd>{fullFormat.format(new Date(log.created_at))}</dd>
        <dt>Record ID</dt><dd>{log.id ?? 'Unknown record'}</dd>
        {metadata.map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</dd></React.Fragment>)}
      </dl>}
    </li>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [profileWarning, setProfileWarning] = useState(false)
  const [limit, setLimit] = useState(25)
  const [revision, setRevision] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef(null)
  const filterButton = useRef(null)
  const toolbarRef = useRef(null)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const invalidDates = range === 'custom' && (!start || !end || start > end)
  const first = range === 'all' ? `${archiveMonth || today.slice(0, 7)}-01` : range === 'custom' ? start : addDays(today, range === 'week' ? -6 : range === 'month' ? -29 : 0)
  const last = range === 'all' ? addDays(`${shiftMonth(archiveMonth || today.slice(0, 7), 1)}-01`, -1) : range === 'custom' ? end : today
  // Keep the existing monthly fetchAll query and profile enrichment unchanged.
  // Each requested month is read separately; filters and 25-row disclosure are local.
  const firstMonth = first?.slice(0, 7)
  const lastMonth = last?.slice(0, 7)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300)
    return () => window.clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const timer = window.setInterval(() => setToday(dateKey()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(() => setToolbarHeight(toolbarRef.current?.getBoundingClientRect().height || 0))
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!panelOpen) return undefined
    panelRef.current?.querySelector('.sel-trigger, input')?.focus()
    function close(event) {
      if (event.key === 'Escape') { setPanelOpen(false); filterButton.current?.focus() }
    }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [panelOpen])

  useEffect(() => {
    let cancelled = false
    async function loadActivityLogs() {
      if (invalidDates) { setLogs([]); setLoading(false); setError(''); return }
      setLoading(true)
      setError('')
      setProfileWarning(false)
      try {
        const activityData = []
        for (let visibleMonth = firstMonth; visibleMonth <= lastMonth; visibleMonth = shiftMonth(visibleMonth, 1)) {
          const monthStart = boundary(visibleMonth)
          const monthEnd = boundary(shiftMonth(visibleMonth, 1))
          const { data: fetchedLogs, error: activityError } = await fetchAll(() =>
            supabase
              .from('activity_log')
              .select('*')
              .gte('created_at', monthStart)
              .lt('created_at', monthEnd)
              .order('created_at', { ascending: false }),
          )
          if (cancelled) return
          if (activityError) throw activityError
          activityData.push(...(fetchedLogs || []))
        }
        const userIds = [...new Set(activityData.map((log) => log.user_id).filter(Boolean))]
        let profileMap = new Map()
        if (userIds.length > 0) {
          const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .in('id', userIds)
          if (cancelled) return
          if (!profileError) profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]))
          else setProfileWarning(true)
        }
        const prepared = activityData.map((log) => {
          const profile = profileMap.get(log.user_id)
          return { ...log, dateKey: dateKey(new Date(log.created_at)), user: profile?.full_name || profile?.email || 'System', role: profile?.role || '', description: log.target || log.description || '' }
        })
        prepared.sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || String(a.id).localeCompare(String(b.id)))
        if (!cancelled) setLogs(prepared)
      } catch (failure) {
        if (!cancelled) { setLogs([]); setError(`Activity logs could not be loaded: ${failure.message || 'Please try again.'}`) }
      } finally { if (!cancelled) setLoading(false) }
    }
    loadActivityLogs()
    return () => { cancelled = true }
  }, [firstMonth, lastMonth, invalidDates, revision])

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    return logs.filter((log) => log.dateKey >= first && log.dateKey <= last && (!user || String(log.user_id || 'system') === user) && (!role || log.role.toLowerCase() === role) && (!action || log.action === action) && matchesActivitySearch(log, term))
  }, [logs, first, last, user, role, action, debouncedSearch])
  const activityStats = useMemo(() => {
    const countBy = (items) => {
      const counts = new Map()
      items.forEach((item) => counts.set(item, (counts.get(item) || 0) + 1))
      return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]
    }
    const mostActive = countBy(filtered.map((log) => log.user || 'System'))
    const topAction = countBy(filtered.map((log) => log.action || 'Other activity'))
    return {
      total: filtered.length,
      mostActive: mostActive ? `${mostActive[0]} (${mostActive[1]})` : '—',
      topAction: topAction ? `${topAction[0]} (${topAction[1]})` : '—',
      payments: filtered.filter((log) => /payment/i.test(log.action || '')).length,
    }
  }, [filtered])
  useEffect(() => { setLimit(25) }, [first, last, user, role, action, debouncedSearch, revision])
  const users = [...new Map(logs.map((log) => [String(log.user_id || 'system'), log.user])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const actions = [...new Set(logs.map((log) => log.action).filter(Boolean))].sort()
  const chips = [
    search && { key: 'search', label: `Search: ${search}`, clear: () => { setSearch(''); setDebouncedSearch('') } },
    user && { key: 'user', label: `User: ${users.find(([id]) => id === user)?.[1] || 'Unknown user'}`, clear: () => setUser('') },
    role && { key: 'role', label: `Role: ${role}`, clear: () => setRole('') },
    action && { key: 'action', label: action, clear: () => setAction('') },
    range !== DEFAULT_RANGE && { key: 'date', label: range === 'custom' ? `${start || 'Start'} – ${end || 'End'}` : RANGE_LABELS[range], clear: () => setRange(DEFAULT_RANGE) },
    range === 'all' && archiveMonth !== today.slice(0, 7) && { key: 'archive', label: archiveMonth, clear: () => setArchiveMonth(today.slice(0, 7)) },
  ].filter(Boolean)
  function clearFilters() { setSearch(''); setDebouncedSearch(''); setUser(''); setRole(''); setAction(''); setRange(DEFAULT_RANGE); setArchiveMonth(today.slice(0, 7)); setStart(today); setEnd(today) }
  const groups = new Map()
  filtered.slice(0, limit).forEach((log) => { if (!groups.has(log.dateKey)) groups.set(log.dateKey, []); groups.get(log.dateKey).push(log) })
  const dateLabel = (key) => key === today ? 'Today' : key === addDays(today, -1) ? 'Yesterday' : groupFormat.format(new Date(`${key}T00:00:00Z`))
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

  return <div className="activity-log-page" style={{ '--al-toolbar-height': `${toolbarHeight}px` }}>
    <header className="al-header"><div><h1>Activity Log</h1><p>Search and review system activity across your team.</p></div></header>
    <section className="al-stats-grid" aria-label="Activity summaries" aria-busy={loading}>
      <article className="al-stat-card"><div className="al-stat-top"><span>Total Events</span><span className="al-stat-icon al-stat-icon-blue"><Activity size={18} /></span></div><strong>{loading ? '—' : activityStats.total.toLocaleString('en-PH')}</strong><small>Matching the current filters</small></article>
      <article className="al-stat-card"><div className="al-stat-top"><span>Most Active User</span><span className="al-stat-icon al-stat-icon-green"><Users size={18} /></span></div><strong className="al-stat-value-text">{loading ? '—' : activityStats.mostActive}</strong><small>Events in the selected range</small></article>
      <article className="al-stat-card"><div className="al-stat-top"><span>Top Action</span><span className="al-stat-icon al-stat-icon-blue"><Zap size={18} /></span></div><strong className="al-stat-value-text">{loading ? '—' : activityStats.topAction}</strong><small>Most common recorded action</small></article>
      <article className="al-stat-card"><div className="al-stat-top"><span>Payments Recorded</span><span className="al-stat-icon al-stat-icon-green"><CreditCard size={18} /></span></div><strong>{loading ? '—' : activityStats.payments.toLocaleString('en-PH')}</strong><small>Payment events in this view</small></article>
    </section>
    <section className="al-toolbar" ref={toolbarRef} aria-label="Activity controls">
      <div className="al-toolbar-main">
        <div className="al-search-row"><label className="al-search"><span className="al-sr-only">Search activity</span><input type="search" aria-label="Search activity" placeholder="User, action, or description" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="button" className="al-filter-toggle" ref={filterButton} aria-expanded={panelOpen} aria-controls="activity-filters" onClick={() => setPanelOpen(!panelOpen)}>Filters{chips.length ? ` (${chips.length})` : ''}</button>
        <button type="button" className="al-refresh" onClick={() => setRevision((value) => value + 1)} disabled={loading} aria-label="Refresh activity" title="Refresh"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8.1 8.1 0 0 0-14.9-4.3L3 9" /><path d="M3 4v5h5" /><path d="M4 13a8.1 8.1 0 0 0 14.9 4.3L21 15" /><path d="M21 20v-5h-5" /></svg></button></div>
        <div id="activity-filters" ref={panelRef} className={`al-filters ${panelOpen ? 'al-open' : ''}`}>
        {select('User', user, setUser, [['', 'All users'], ...users])}
        {select('Role', role, setRole, [['', 'All roles'], ['admin', 'Admin'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer']])}
        {select('Action type', action, setAction, [['', 'All actions'], ...actions.map((value) => [value, value])])}
        {select('Date range', range, setRange, Object.entries(RANGE_LABELS))}
        {range === 'all' && <label>Archive month<DateField value={archiveMonth} onChange={(value) => setArchiveMonth(value || today.slice(0, 7))} max={today.slice(0, 7)} ariaLabel="Archive month" monthOnly /></label>}
        {range === 'custom' && <><label>From<DateField value={start} max={end || today} onChange={setStart} ariaLabel="From date" /></label><label>Through<DateField value={end} min={start} max={today} onChange={setEnd} ariaLabel="Through date" /></label></>}
        <button type="button" className="al-filter-done" onClick={() => { setPanelOpen(false); filterButton.current?.focus() }}>Done</button>
        </div>
      </div>
      {chips.length > 0 && <div className="al-chips" aria-label="Active filters">{chips.map((chip) => <button type="button" key={chip.key} onClick={chip.clear} aria-label={`Remove ${chip.label} filter`}>{chip.label}<span aria-hidden="true"> ×</span></button>)}<button type="button" className="al-clear" onClick={clearFilters}>Clear filters</button></div>}
      {invalidDates && <p role="alert">Choose a valid start and end date.</p>}
    </section>
    <section className="al-list" aria-label="Activity entries" aria-busy={loading}>
      <p className="al-result-count" role="status">{loading ? <Skeleton variant="rect" width="120px" height="1em" /> : error ? 'Activity unavailable' : `${filtered.length.toLocaleString('en-PH')} results`}</p>
      <div className="al-columns" aria-hidden="true"><span>User</span><span>Action</span><span>Summary</span><span>Amount</span><span>Time</span><span /></div>
      {profileWarning && !loading && <p className="al-notice" role="status">Some user details are unavailable. Activity is still shown; missing profiles use System and Unknown role.</p>}
      {loading ? <div role="status" aria-label="Loading activity">{Array.from({ length: 6 }, (_, index) => <div className="al-skeleton" key={index} aria-hidden="true"><Skeleton variant="rect" width="100%" height="1em" /><Skeleton variant="rect" width="100%" height="1em" /><Skeleton variant="rect" width="100%" height="1em" /><Skeleton variant="rect" width="100%" height="1em" /><Skeleton variant="rect" width="100%" height="1em" /><Skeleton variant="rect" width="24px" height="1em" /></div>)}</div> : error ? <div className="al-state" role="alert"><h2>Unable to load activity</h2><p>{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div> : filtered.length === 0 ? <div className="al-state"><h2>{chips.length ? 'No matching activity' : range === DEFAULT_RANGE ? 'No activity today' : 'No activity yet'}</h2><p>{chips.length ? 'Try another search or date range.' : range === DEFAULT_RANGE ? 'Activity recorded today will appear here. Choose Last 7 days to see earlier entries.' : 'Recorded activity will appear here for the selected month.'}</p>{chips.length > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</div> : [...groups.entries()].map(([key, entries]) => <section key={key} aria-label={dateLabel(key)}><h2 className="al-date">{dateLabel(key)}</h2><ul>{entries.map((log) => <ActivityRow key={log.id} log={log} />)}</ul></section>)}
      {!loading && !error && <footer className="al-footer"><span role="status">Showing {Math.min(limit, filtered.length)} of {filtered.length.toLocaleString('en-PH')}</span>{limit < filtered.length && <button type="button" onClick={() => setLimit((value) => value + 25)}>Load more</button>}</footer>}
    </section>
  </div>
}
