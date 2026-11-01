import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import Select from '../components/Select'
import DateField from '../components/DateField'
import './ActivityLogPage.css'

const ZONE = 'Asia/Manila'
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFormat = new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hour12: true })
const fullFormat = new Intl.DateTimeFormat('en-PH', { timeZone: ZONE, dateStyle: 'full', timeStyle: 'long', hour12: true })
const groupFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const RANGE_LABELS = { all: 'Selected month', today: 'Today', week: 'Last 7 days', month: 'Last 30 days', custom: 'Custom' }
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
export function activityDisplay(log) {
  const raw = String(log.target || log.description || '')
  const suffix = ` (by ${log.user})`
  const text = raw.endsWith(suffix) ? raw.slice(0, -suffix.length) : raw
  const parts = text.split(' — ')
  const expected = { 'Payment Recorded': 3, 'Charge Added': 3, 'Payment Voided': 4, 'Charge Voided': 4, 'Document Uploaded': 2, 'Document Deleted': 2 }
  const moneyAction = /^(Payment Recorded|Charge Added|Payment Voided|Charge Voided)$/.test(log.action || '')
  const parsed = parts.length === expected[log.action] && parts.every((part) => part.trim()) && (!moneyAction || /^₱\s*-?[\d,]+(?:\.\d{1,2})?$/.test(parts[2]))
  const money = text.match(/₱\s*(-?\d[\d,]*(?:\.\d{1,2})?)(?![\d.])/)
  const structuredAmount = typeof log.amount === 'number' && Number.isFinite(log.amount) ? log.amount : null
  const amount = structuredAmount ?? (money ? Number(money[1].replaceAll(',', '')) : null)
  return {
    raw, text,
    subject: log.subject || (parsed ? parts[0] : text) || 'Unknown record',
    detail: parsed ? parts.slice(1).filter((part) => !/^₱\s*-?[\d,.]+$/.test(part) && part.replace(/\.[^.]+$/, '') !== parts[0]).join(' — ') : '',
    amount,
    status: /fail|error/i.test(log.action || '') ? 'failed' : /delet|void|cancel/i.test(log.action || '') ? 'warning' : '',
  }
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
        <div className="al-action"><span className="al-badge" title={log.action || 'Activity'}>{log.action || 'Activity'}</span></div>
        <div className="al-summary">
          {display.status && <span className="al-exception" role="img" aria-label={display.status === 'failed' ? 'Failed event' : 'Destructive action'}>{display.status === 'failed' ? '!' : '⚠'}</span>}
          <div className="al-summary-text"><strong>{display.subject}</strong>{display.detail && <span>{display.detail}</span>}</div>
        </div>
        <div className="al-amount">{display.amount !== null ? peso.format(display.amount) : <span aria-label="No amount">—</span>}</div>
        <time className="al-time" dateTime={log.created_at} title={fullFormat.format(new Date(log.created_at))}>{timeFormat.format(new Date(log.created_at))}</time>
        <button type="button" className="al-expand" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${log.action || 'activity'} details for ${log.user}`} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : '+'}</button>
      </div>
      {expanded && <dl id={detailsId} className="al-details">
        <dt>Description</dt><dd>{display.text || 'Unknown record'}</dd>
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
  const [range, setRange] = useState('today')
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
    return logs.filter((log) => log.dateKey >= first && log.dateKey <= last && (!user || String(log.user_id || 'system') === user) && (!role || log.role.toLowerCase() === role) && (!action || log.action === action) && (!term || `${log.user} ${log.action || ''} ${log.description}`.toLowerCase().includes(term)))
  }, [logs, first, last, user, role, action, debouncedSearch])
  useEffect(() => { setLimit(25) }, [first, last, user, role, action, debouncedSearch, revision])
  const users = [...new Map(logs.map((log) => [String(log.user_id || 'system'), log.user])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const actions = [...new Set(logs.map((log) => log.action).filter(Boolean))].sort()
  const chips = [
    search && { key: 'search', label: `Search: ${search}`, clear: () => { setSearch(''); setDebouncedSearch('') } },
    user && { key: 'user', label: `User: ${users.find(([id]) => id === user)?.[1] || 'Unknown user'}`, clear: () => setUser('') },
    role && { key: 'role', label: `Role: ${role}`, clear: () => setRole('') },
    action && { key: 'action', label: action, clear: () => setAction('') },
    range !== 'all' && { key: 'date', label: range === 'custom' ? `${start || 'Start'} – ${end || 'End'}` : RANGE_LABELS[range], clear: () => setRange('all') },
    range === 'all' && archiveMonth !== today.slice(0, 7) && { key: 'archive', label: archiveMonth, clear: () => setArchiveMonth(today.slice(0, 7)) },
  ].filter(Boolean)
  function clearFilters() { setSearch(''); setDebouncedSearch(''); setUser(''); setRole(''); setAction(''); setRange('all'); setArchiveMonth(today.slice(0, 7)); setStart(today); setEnd(today) }
  const groups = new Map()
  filtered.slice(0, limit).forEach((log) => { if (!groups.has(log.dateKey)) groups.set(log.dateKey, []); groups.get(log.dateKey).push(log) })
  const dateLabel = (key) => key === today ? 'Today' : key === addDays(today, -1) ? 'Yesterday' : groupFormat.format(new Date(`${key}T00:00:00Z`))
  const select = (label, value, onChange, options) => (
    <label key={label}>
      {label}
      <Select
        ariaLabel={label}
        value={value}
        onChange={onChange}
        options={options.map(([key, name]) => ({ value: key, label: name }))}
      />
    </label>
  )

  return <div className="activity-log-page" style={{ '--al-toolbar-height': `${toolbarHeight}px` }}>
    <header className="al-header"><div><h1>Activity Log</h1><p>Search and review system activity across your team.</p></div><span className="al-count" role="status">{loading ? 'Loading activity…' : error ? 'Activity unavailable' : `${filtered.length.toLocaleString('en-PH')} results`}</span></header>
    <section className="al-toolbar" ref={toolbarRef} aria-label="Activity controls">
      <div className="al-search-row"><label className="al-search">Search activity<input type="search" placeholder="User, action, or description" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="button" className="al-filter-toggle" ref={filterButton} aria-expanded={panelOpen} aria-controls="activity-filters" onClick={() => setPanelOpen(!panelOpen)}>Filters{chips.length ? ` (${chips.length})` : ''}</button>
        <button type="button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>Refresh</button></div>
      <div id="activity-filters" ref={panelRef} className={`al-filters ${panelOpen ? 'al-open' : ''}`}>
        {select('User', user, setUser, [['', 'All users'], ...users])}
        {select('Role', role, setRole, [['', 'All roles'], ['admin', 'Admin'], ['secretary', 'Secretary'], ['treasurer', 'Treasurer']])}
        {select('Action type', action, setAction, [['', 'All actions'], ...actions.map((value) => [value, value])])}
        {select('Date range', range, setRange, Object.entries(RANGE_LABELS))}
        {range === 'all' && <label>Archive month<DateField value={archiveMonth} onChange={(value) => setArchiveMonth(value || today.slice(0, 7))} max={today.slice(0, 7)} ariaLabel="Archive month" monthOnly /></label>}
        {range === 'custom' && <><label>From<DateField value={start} max={end || today} onChange={setStart} ariaLabel="From date" /></label><label>Through<DateField value={end} min={start} max={today} onChange={setEnd} ariaLabel="Through date" /></label></>}
        <button type="button" className="al-filter-done" onClick={() => { setPanelOpen(false); filterButton.current?.focus() }}>Done</button>
      </div>
      {chips.length > 0 && <div className="al-chips" aria-label="Active filters">{chips.map((chip) => <button type="button" key={chip.key} onClick={chip.clear} aria-label={`Remove ${chip.label} filter`}>{chip.label}<span aria-hidden="true"> ×</span></button>)}<button type="button" className="al-clear" onClick={clearFilters}>Clear filters</button></div>}
      {invalidDates && <p role="alert">Choose a valid start and end date.</p>}
    </section>
    <section className="al-list" aria-label="Activity entries" aria-busy={loading}>
      <div className="al-columns" aria-hidden="true"><span>User</span><span>Action</span><span>Summary</span><span>Amount</span><span>Time</span><span /></div>
      {profileWarning && !loading && <p className="al-notice" role="status">Some user details are unavailable. Activity is still shown; missing profiles use System and Unknown role.</p>}
      {loading ? <div role="status" aria-label="Loading activity"><span className="al-sr-only">Loading activity</span>{Array.from({ length: 6 }, (_, index) => <div className="al-skeleton" key={index} aria-hidden="true"><i /><i /><i /></div>)}</div> : error ? <div className="al-state" role="alert"><h2>Unable to load activity</h2><p>{error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div> : filtered.length === 0 ? <div className="al-state"><h2>{chips.length ? 'No matching activity' : 'No activity yet'}</h2><p>{chips.length ? 'Try another search or date range.' : 'Recorded activity will appear here for the selected month.'}</p>{chips.length > 0 && <button type="button" onClick={clearFilters}>Clear filters</button>}</div> : [...groups.entries()].map(([key, entries]) => <section key={key} aria-label={dateLabel(key)}><h2 className="al-date">{dateLabel(key)}</h2><ul>{entries.map((log) => <ActivityRow key={log.id} log={log} />)}</ul></section>)}
      {!loading && !error && <footer className="al-footer"><span role="status">Showing {Math.min(limit, filtered.length)} of {filtered.length.toLocaleString('en-PH')}</span>{limit < filtered.length && <button type="button" onClick={() => setLimit((value) => value + 25)}>Load more</button>}</footer>}
    </section>
  </div>
}
