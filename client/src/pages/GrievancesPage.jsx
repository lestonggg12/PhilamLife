import React, { useEffect, useMemo, useRef, useState } from 'react'
import { downloadGrievanceBackup } from '../lib/grievanceBackup'
import { supabase } from '../lib/supabaseClient'
import GrievanceCloudCreate from '../components/GrievanceCloudCreate'
import { createPortal } from 'react-dom'

// Resolve the date in the HOA timezone rather than freezing a past calendar date.
// This is refreshed when the page is reloaded; live midnight rollover is a separate follow-up.
const TODAY = (() => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
})()
const STORAGE_KEY = 'philamlife.grievances.panel.cases'
const CATEGORIES = ['Noise', 'Parking', 'Pets', 'Maintenance', 'Neighbor dispute', 'Dues or payment dispute', 'Rule violation', 'Officer conduct', 'Other']
const STATUSES = ['Open', 'In progress', 'Resolved']
const EMPTY_RECORD = { id: '', category: 'Noise', title: '', filedBy: '', concerns: '', lot: '', location: '', incidentDate: '', filedDate: TODAY, handler: '', followUp: '', status: 'Open', description: '', requestedAction: '', outcome: '', history: [] }

const dateObject = (value) => new Date(`${value}T00:00:00`)
const formatDate = (value) => value ? dateObject(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const dayDifference = (from, to) => Math.round((dateObject(to) - dateObject(from)) / 86400000)
const isClosedCase = (item) => ['Resolved', 'Dismissed', 'Withdrawn'].includes(item.status)
const isOpenCase = (item) => item.status === 'Open' || item.status === 'Received'
const isInProgress = (item) => !isClosedCase(item) && !isOpenCase(item)
const isOverdue = (item) => item.followUp && !isClosedCase(item) && item.followUp <= TODAY
const isDueSoon = (item) => item.followUp && !isClosedCase(item) && dayDifference(TODAY, item.followUp) >= 0 && dayDifference(TODAY, item.followUp) <= 3
const slug = (value) => value.toLowerCase().replace(' ', '-')

function Icon({ name, size = 18 }) {
  const paths = { search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>, refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14M21 19v-5h-5" /></>, plus: <path d="M12 5v14M5 12h14" />, file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>, clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>, warning: <><path d="m12 4 8 15H4L12 4Z" /><path d="M12 9v4M12 16h.01" /></>, check: <><circle cx="12" cy="12" r="8" /><path d="m8 12 2.5 2.5L16 9" /></>, close: <><path d="m6 6 12 12M18 6 6 18" /></>, chevron: <path d="m9 6 6 6-6 6" /> }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function statusPill(status) { return <span className={`status-pill ${slug(status)}`}><i />{status}</span> }

function Field({ label, optional = false, required = false, children, wide = false }) {
  return <label className={wide ? 'form-field wide' : 'form-field'}><span>{label} <em>{required ? '(required)' : optional ? '(optional)' : ''}</em></span>{children}</label>
}

export default function GrievancesPage() {
  const [cases, setCases] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [tab, setTab] = useState('register')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All categories')
  const [handler, setHandler] = useState('All handlers')
  const [filter, setFilter] = useState('all')
  const [modal, setModal] = useState(null)
  const [showCloudForm, setShowCloudForm] = useState(false)
  const [draft, setDraft] = useState(null)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [cloudCheck, setCloudCheck] = useState({ state: 'checking', count: null })
  const [sharedCases, setSharedCases] = useState([])
  const [cloudRefresh, setCloudRefresh] = useState(0)
  const lastFocus = useRef(null)

  const displayCases = useMemo(() => {
    const cloud = cloudCheck.state === 'ready' ? sharedCases.map(item => {
      const filed = item.filed_at ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(new Date(item.filed_at)) : []
      const part = type => filed.find(value => value.type === type)?.value || ''
      return {
        id: 'GR-' + item.case_number, title: item.title, category: item.category,
        filedBy: item.complainant, concerns: item.respondent || '',
        location: item.location || '', lot: '', handler: item.assigned_handler || '',
        status: item.status, followUp: item.follow_up_date || '',
        filedDate: filed.length ? [part('year'), part('month'), part('day')].join('-') : '',
        _shared: true,
      }
    }) : []
    return [...cloud, ...cases]
  }, [cases, sharedCases, cloudCheck.state])

  const handlerOptions = useMemo(() => ['All handlers', ...new Set(displayCases.map((item) => item.handler).filter(Boolean))], [displayCases])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return displayCases.filter((item) => {
      const text = [item.id, item.category, item.title, item.filedBy, item.concerns, item.lot, item.location, item.handler].join(' ').toLowerCase()
      const matchesFilter = filter === 'all' || (filter === 'active' && !isClosedCase(item)) || (filter === 'overdue' && isOverdue(item)) || (filter === 'resolved' && isClosedCase(item)) || (filter === 'open' && isOpenCase(item)) || (filter === 'progress' && isInProgress(item))
      return (!term || text.includes(term)) && (category === 'All categories' || item.category === category) && (handler === 'All handlers' || item.handler === handler) && matchesFilter
    })
  }, [displayCases, search, category, handler, filter])
  const chipCounts = useMemo(() => {
    const term = search.trim().toLowerCase()
    const base = displayCases.filter((item) => { const text = [item.id, item.category, item.title, item.filedBy, item.concerns, item.lot, item.location, item.handler].join(' ').toLowerCase(); return (!term || text.includes(term)) && (category === 'All categories' || item.category === category) && (handler === 'All handlers' || item.handler === handler) })
    return { all: base.length, open: base.filter(isOpenCase).length, progress: base.filter(isInProgress).length, resolved: base.filter((item) => item.status === 'Resolved').length, overdue: base.filter(isOverdue).length }
  }, [displayCases, search, category, handler])
  const stats = useMemo(() => {
    const resolved = displayCases.filter(item => item.status === 'Resolved')
    const active = displayCases.filter(item => !isClosedCase(item))
    const due = displayCases.filter(isOverdue)
    const oldest = due.reduce((max, item) => Math.max(max, dayDifference(item.followUp, TODAY)), 0)
    const total = displayCases.length
    return {
      total, filed: displayCases.filter(item => item.filedDate?.slice(0, 7) === TODAY.slice(0, 7)).length,
      active: active.length, progress: displayCases.filter(isInProgress).length,
      open: displayCases.filter(isOpenCase).length,
      due: due.length, oldest, resolved: resolved.length,
      rate: total ? Math.round(resolved.length / total * 100) : 0,
    }
  }, [displayCases])
  const selectedCase = modal?.type === 'case' ? cases.find((item) => item.id === modal.id) : null

  // Read the full authorized shared register; the first 25 are shown in the compact preview.
  // Existing browser-local cases are never modified by this query.
  useEffect(() => {
    let active = true
    async function loadSharedRegister() {
      const rows = []
      const pageSize = 250
      let count = 0
      try {
        for (let start = 0; start < 100000; start += pageSize) {
          const { data, count: total, error } = await supabase.from('grievance_cases')
            .select('id,case_number,title,status,category,complainant,respondent,location,assigned_handler,filed_at,follow_up_date', { count: 'exact' })
            .order('filed_at', { ascending: false })
            .range(start, start + pageSize - 1)
          if (error) throw error
          if (!Array.isArray(data)) throw new Error('Shared grievance records are unavailable.')
          rows.push(...data)
          count = total ?? rows.length
          if (rows.length >= count || data.length < pageSize) break
        }
        if (active) {
          setSharedCases(rows)
          setCloudCheck({ state: 'ready', count })
        }
      } catch {
        if (active) {
          setSharedCases([])
          setCloudCheck({ state: 'error', count: null })
        }
      }
    }
    void loadSharedRegister()
    return () => { active = false }
  }, [cloudRefresh])

  useEffect(() => {
    document.body.style.overflow = modal || showCloudForm ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [modal, showCloudForm])
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cases))
  }, [cases])
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === '/' && !modal && !showCloudForm && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { event.preventDefault(); document.querySelector('[data-grievance-search]')?.focus() }
      if (event.key === 'Escape' && showCloudForm) setShowCloudForm(false)
      if (event.key === 'Escape' && modal && (modal.type === 'case' || modal.type === 'form')) closeModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modal, showCloudForm])
  useEffect(() => { if (!toast) return undefined; const timer = window.setTimeout(() => setToast(''), 2800); return () => window.clearTimeout(timer) }, [toast])

  function closeModal() { setModal(null); setDraft(null); setFormError(''); window.setTimeout(() => lastFocus.current?.focus?.(), 0) }
  function openForm(record = null, trigger) {
    if (!record) { setShowCloudForm(true); return }
    lastFocus.current = trigger || document.activeElement
    setDraft({ ...record })
    setFormError('')
    setModal({ type: 'form', editing: true })
  }
  function openCase(record, trigger) { if (record._shared) { setToast('Shared cases are read-only until cloud editing is enabled.'); return } lastFocus.current = trigger || document.activeElement; setDraft({ ...record }); setFormError(''); setModal({ type: 'case', id: record.id }) }
  function updateDraft(key, value) { setDraft((current) => ({ ...current, [key]: value })) }
  function clearFilters() { setSearch(''); setCategory('All categories'); setHandler('All handlers'); setFilter('all') }
  function toggleFilter(value) { setFilter((current) => current === value ? 'all' : value) }
  function refresh() { setRefreshing(true); setCloudRefresh(value => value + 1); window.setTimeout(() => { setRefreshing(false); setToast('Grievance register refreshed') }, 350) }
  function backUpLocalCases() {
    try {
      const saved = downloadGrievanceBackup(cases)
      setToast(saved ? 'Grievance backup downloaded. Store this file securely.' : 'There are no local grievances to back up.')
    } catch {
      setToast('The backup could not be downloaded. Your existing records were not changed.')
    }
  }
  function validateRecord(record, note, editing) {
    if (!record.title.trim() || !record.filedBy.trim() || !record.concerns.trim() || !record.location.trim() || !record.description.trim()) return 'Complete the title, people involved, location and description.'
    if (!note.trim()) return 'Add a note explaining this record or update.'
    if (record.incidentDate && record.incidentDate > TODAY) return 'The incident date cannot be in the future.'
    if (editing && record.status === 'Resolved' && !record.outcome.trim()) return 'Add an outcome before resolving this case.'
    return ''
  }
  function saveForm(event) {
    event.preventDefault()
    const note = draft.updateNote || draft.filingNote || ''
    const error = validateRecord(draft, note, modal.editing)
    if (error) { setFormError(error); return }
    const id = modal.editing ? draft.id : `GR-${String(cases.length + 1).padStart(5, '0')}`
    const historyEntry = { date: TODAY, title: modal.editing ? `Status: ${selectedCase?.status || 'Open'} → ${draft.status}` : 'Complaint received', note: note.trim(), by: 'Secretary' }
    const next = { ...draft, id, filedDate: draft.filedDate || TODAY, filingNote: undefined, updateNote: undefined, history: modal.editing ? [...(selectedCase?.history || []), historyEntry] : [historyEntry] }
    setCases((current) => modal.editing ? current.map((item) => item.id === id ? next : item) : [next, ...current])
    setToast(`${id} ${modal.editing ? 'updated' : 'recorded'} successfully.`)
    clearFilters()
    closeModal()
  }
  function saveCaseUpdate(event) {
    event.preventDefault()
    const note = draft.updateNote?.trim() || ''
    if (!note) { setFormError('Add a note explaining this record or update.'); return }
    if (draft.status === 'Resolved' && !draft.outcome?.trim()) { setFormError('Add an outcome before resolving this case.'); return }
    const previous = selectedCase.status
    const historyEntry = { date: TODAY, title: previous === draft.status ? 'Case note added' : `Status: ${previous} → ${draft.status}`, note, by: 'Secretary' }
    setCases((current) => current.map((item) => item.id === draft.id ? { ...draft, updateNote: undefined, history: [...(item.history || []), historyEntry] } : item))
    setToast(`${draft.id} updated successfully.`)
    closeModal()
  }

  const hasFilters = Boolean(search || category !== 'All categories' || handler !== 'All handlers' || filter !== 'all')
  const chips = [['all', 'All', chipCounts.all], ['open', 'Open', chipCounts.open], ['progress', 'In progress', chipCounts.progress], ['resolved', 'Resolved', chipCounts.resolved], ['overdue', 'Follow-up due', chipCounts.overdue]]
  return <>
    <style>{styles}</style>
    <main className="grievance-app">
      <header className="grievance-hero"><div><p className="grievance-eyebrow">Secretary workspace</p><h1>Grievances</h1><p className="grievance-subtitle">Record complaints, follow their progress and prepare period statements.</p></div><div className="grievance-actions"><button className="button-outline" type="button" onClick={backUpLocalCases}>Back up cases</button><button className="button-outline" type="button" onClick={refresh} disabled={refreshing}><Icon name="refresh" size={16} />{refreshing ? 'Refreshing...' : 'Refresh'}</button><button className="button-primary" type="button" onClick={(event) => openForm(null, event.currentTarget)}><Icon name="plus" size={17} />Record grievance</button></div></header>
      <div className="grievance-cloud-info">
        <p role="status" className="grievance-cloud-status">
          {cloudCheck.state === 'checking' ? 'Checking shared grievance storage…'
            : cloudCheck.state === 'error' ? 'Shared grievance storage unavailable. Browser records are unchanged.'
              : `Shared grievance storage connected: ${cloudCheck.count} case(s). Browser records are not migrated yet.`}
        </p>
        {cloudCheck.state === 'ready' && sharedCases.length > 0 && (
          <details className="grievance-cloud-preview">
            <summary>View shared cases ({cloudCheck.count})</summary>
            <p>Latest {Math.min(sharedCases.length, 25)} shared cases (read-only).</p>
            <ul>
              {sharedCases.slice(0, 25).map(item => (
                <li key={item.id}>
                  <strong>{`GR-${item.case_number}: ${item.title}`}</strong>
                  {' — '}{item.status}{' · '}{item.category}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <nav className="grievance-tabs" role="tablist" aria-label="Grievance views"><button type="button" role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'is-active' : ''} onClick={() => setTab('register')}>Case register</button><button type="button" role="tab" aria-selected={tab === 'statement'} className={tab === 'statement' ? 'is-active' : ''} onClick={() => setTab('statement')}>Period statement</button></nav>
      {tab === 'statement' ? <section className="statement-placeholder" role="tabpanel"><span className="statement-icon"><Icon name="file" size={22} /></span><h2>Period statement</h2><p>Statement preparation will appear here when the case register is connected to real data.</p><button className="button-outline" type="button" onClick={() => setTab('register')}>Return to case register</button></section> : <>
        <section className="grievance-stats" aria-label="Grievance summaries"><StatCard label="Total cases" value={stats.total} note={`${stats.filed} filed this month`} icon="file" selected={filter === 'all'} onClick={() => toggleFilter('all')} /><StatCard label="Active cases" value={stats.active} note={`${stats.progress} in progress, ${stats.open} not started`} icon="clock" tone="amber" selected={filter === 'active'} onClick={() => toggleFilter('active')} /><StatCard label="Follow-up due" value={stats.due} note={stats.due ? `Oldest is ${stats.oldest} days overdue` : 'Nothing overdue'} icon="warning" tone="red" danger={stats.due > 0} selected={filter === 'overdue'} onClick={() => toggleFilter('overdue')} /><StatCard label="Resolution rate" value={`${stats.rate}%`} note={`${stats.resolved} of ${stats.total} resolved`} icon="check" tone="green" selected={filter === 'resolved'} onClick={() => toggleFilter('resolved')} progress={stats.rate} /></section>
        <section className="register-panel"><div className="status-chips" aria-label="Case status filters">{chips.map(([value, label, count]) => <button type="button" key={value} className={`${filter === value ? 'is-active' : ''} ${value === 'overdue' && filter === value ? 'is-danger' : ''}`} onClick={() => toggleFilter(value)} aria-pressed={filter === value}>{label}<span>{count}</span></button>)}</div><div className="filter-bar"><label className="search-field"><span className="sr-only">Search cases</span><Icon name="search" size={17} /><input data-grievance-search type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, title, location or handler…" /><kbd>/</kbd></label><label><span className="sr-only">Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="sr-only">Handler</span><select value={handler} onChange={(event) => setHandler(event.target.value)}>{handlerOptions.map((item) => <option key={item}>{item}</option>)}</select></label>{hasFilters && <button className="clear-link" type="button" onClick={clearFilters}>Clear filters</button>}</div><div className="case-table" role="table" aria-label="Grievance cases"><div className="case-heading" role="row"><span>Case ID</span><span>Case / homeowner</span><span>Lot</span><span>Handler</span><span>Follow-up</span><span>Status</span><span /></div>{filtered.map((item) => <button className="case-row" role="row" type="button" key={item.id} onClick={(event) => openCase(item, event.currentTarget)}><span className="case-id"><strong>{item.id}</strong><small>{item.category}</small></span><span className="case-title"><strong>{item.title}</strong><small>Filed by {item.filedBy} <b>→</b> {item.concerns}</small></span><span data-label="Lot">{item.lot || '—'}</span><span data-label="Handler">{item.handler || '—'}</span><span data-label="Follow-up" className={`follow-up ${isOverdue(item) ? 'is-overdue' : isDueSoon(item) ? 'is-soon' : ''}`}>{isOverdue(item) && <Icon name="warning" size={14} />}{formatDate(item.followUp)}</span><span data-label="Status">{statusPill(item.status)}</span><span className="row-chevron"><Icon name="chevron" size={18} /></span></button>)}{!filtered.length && <EmptyState filtered={hasFilters} onClear={clearFilters} onRecord={(event) => openForm(null, event.currentTarget)} />}</div><footer className="table-footer"><span>Showing {filtered.length} of {displayCases.length} cases</span><span>Click a row to view or update</span></footer></section>
      </>}
    </main>
    {showCloudForm && (
      <CloudGrievanceModal label="Record a grievance" onClose={() => setShowCloudForm(false)}>
        {cloudCheck.state === 'ready' ? (
          <GrievanceCloudCreate
            onSaved={() => setCloudRefresh(value => value + 1)}
            onClose={() => setShowCloudForm(false)}
          />
        ) : (
          <div className="gc-modal-content">
            <header className="gc-header"><h2>Shared storage unavailable</h2>
              <button type="button" className="gc-icon-close"
                onClick={() => setShowCloudForm(false)} aria-label="Close">×</button>
            </header>
            <div className="gc-body"><p role="alert">Shared grievance storage is not connected. Please try again when it is available.</p></div>
            <footer className="gc-footer"><button type="button" className="gc-button gc-button-secondary"
              onClick={() => setShowCloudForm(false)}>Close</button></footer>
          </div>
        )}
      </CloudGrievanceModal>
    )}
    {modal?.type === 'case' && selectedCase && <CaseDialog draft={draft} setDraft={setDraft} onClose={closeModal} onEdit={() => { lastFocus.current = document.activeElement; setModal({ type: 'form', editing: true }) }} onSave={saveCaseUpdate} error={formError} />}
    {modal?.type === 'form' && draft && <FormDialog draft={draft} setDraft={setDraft} editing={modal.editing} onClose={closeModal} onSave={saveForm} error={formError} />}
    {toast && <div className="grievance-toast" role="status">{toast}</div>}
  </>
}

// Only the pilot cloud form uses this portal. Legacy grievance dialogs are unchanged.
function CloudGrievanceModal({ children, label, onClose }) {
  const panelRef = useRef(null)
  const restoreFocusRef = useRef(null)
  useEffect(() => {
    restoreFocusRef.current = document.activeElement
    panelRef.current?.querySelector('input,select,textarea,button')?.focus()
    return () => restoreFocusRef.current?.focus?.()
  }, [])

  function trapFocus(event) {
    if (event.key !== 'Tab') return
    const controls = [...panelRef.current.querySelectorAll('input,select,textarea,button,[tabindex]')]
      .filter(node => !node.disabled && node.tabIndex !== -1 && node.getClientRects().length > 0)
    if (!controls.length) { event.preventDefault(); return }
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, boxSizing: 'border-box', overflowY: 'auto',
      background: 'rgba(15, 63, 106, 0.55)',
      '--blue': '#1464a0', '--dark': '#0f3f6a', '--ink': '#071e30',
      '--body': '#2a5470', '--muted': '#5a7a92',
    }}>
      <section ref={panelRef} role="dialog" aria-modal="true" aria-label={label}
        onKeyDown={trapFocus} style={{
          width: 'min(960px, calc(100vw - 24px))',
          maxHeight: '90dvh',
          overflow: 'hidden',
          margin: 'auto',
          borderRadius: 18,
          border: '1px solid #c5dfed',
          background: '#edf6fd',
          boxShadow: '0 24px 70px rgba(7,30,48,.33)',
          boxSizing: 'border-box',
        }}>
        {children}
      </section>
    </div>,
    document.body,
  )
}

function StatCard({ label, value, note, icon, tone = 'blue', danger = false, selected, onClick, progress }) { return <button type="button" className={`stat-card ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onClick}><span className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={17} /></span></span><strong className={danger ? 'danger-number' : ''}>{value}</strong><small>{note}</small>{progress !== undefined && <span className="progress-track"><span style={{ width: `${progress}%` }} /></span>}</button> }
function EmptyState({ filtered, onClear, onRecord }) { return <div className="empty-state"><span className="statement-icon"><Icon name={filtered ? 'search' : 'file'} size={22} /></span><h2>{filtered ? 'No cases match these filters' : 'No grievances found'}</h2><p>{filtered ? 'Try clearing a filter or searching for a different case.' : 'Record a complaint or adjust your search filters.'}</p>{filtered ? <button className="button-outline" type="button" onClick={onClear}>Clear filters</button> : <button className="button-primary" type="button" onClick={onRecord}><Icon name="plus" size={16} />Record grievance</button>}</div> }

function CaseDialog({ draft, setDraft, onClose, onEdit, onSave, error }) { return <Dialog className="case-dialog" label={`${draft.id} case details`} onClose={onClose} backdropClose><header className="dialog-top"><div><p className="drawer-kicker">{draft.id} · {draft.category}</p><h2>{draft.title}</h2><div className="case-meta">{statusPill(draft.status)}<span>Filed {formatDate(draft.filedDate)} by {draft.filedBy || '—'}</span><span className={isOverdue(draft) ? 'is-overdue' : ''}>Follow-up {formatDate(draft.followUp)}</span></div></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close case"><Icon name="close" size={19} /></button></header><div className="case-dialog-grid"><div className="case-content"><InfoCard title="What happened"><p>{draft.description || 'No description recorded.'}</p></InfoCard><InfoCard title="Requested action"><p>{draft.requestedAction || 'No requested action recorded.'}</p></InfoCard>{draft.outcome && <InfoCard title="Outcome"><p>{draft.outcome}</p></InfoCard>}<InfoCard title="Case history"><div className="timeline">{(draft.history || []).slice().reverse().map((entry, index) => <article key={`${entry.date}-${index}`}><span className="timeline-dot" /><strong>{entry.title}</strong><small>{formatDate(entry.date)} · {entry.by}</small><p>{entry.note}</p></article>)}</div></InfoCard></div><div className="case-side"><section className="dialog-card"><h3>Update status</h3><div className="segmented-status">{STATUSES.map((status) => <button type="button" key={status} className={draft.status === status ? `is-active ${slug(status)}` : ''} onClick={() => setDraft({ ...draft, status })}>{status}</button>)}</div>{draft.status === 'Resolved' && <Field label="Outcome" required><textarea rows={3} value={draft.outcome} onChange={(event) => setDraft({ ...draft, outcome: event.target.value })} /></Field>}<Field label="Update note" required><textarea rows={4} value={draft.updateNote || ''} onChange={(event) => setDraft({ ...draft, updateNote: event.target.value })} /></Field>{error && <p className="form-error" role="alert">{error}</p>}<button className="button-primary full-button" type="button" onClick={onSave}>Save update</button></section><section className="dialog-card"><h3>Details</h3><dl className="details-list"><div><dt>Filed by</dt><dd>{draft.filedBy || '—'}</dd></div><div><dt>Concerns</dt><dd>{draft.concerns || '—'}</dd></div><div><dt>Lot</dt><dd>{draft.lot || '—'}</dd></div><div><dt>Location</dt><dd>{draft.location || '—'}</dd></div><div><dt>Incident date</dt><dd>{formatDate(draft.incidentDate)}</dd></div><div><dt>Handler</dt><dd>{draft.handler || '—'}</dd></div><div><dt>Follow-up</dt><dd>{formatDate(draft.followUp)}</dd></div></dl></section></div></div><footer className="dialog-footer"><button className="button-outline" type="button" onClick={onEdit}>Edit details</button></footer></Dialog> }
function InfoCard({ title, children }) { return <section className="dialog-card"><h3>{title}</h3>{children}</section> }
function FormDialog({ draft, setDraft, editing, onClose, onSave, error }) { const update = (key, value) => setDraft({ ...draft, [key]: value }); return <Dialog className="form-dialog" label={editing ? `${draft.id} edit details` : 'Record a grievance'} onClose={onClose}><header className="dialog-top"><div><p className="drawer-kicker">{editing ? draft.id : 'New complaint'}</p><h2>{editing ? 'Edit details' : 'Record a grievance'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close form"><Icon name="close" size={19} /></button></header><form onSubmit={onSave}><div className="form-grid"><Field label="Title" required wide><input value={draft.title} onChange={(event) => update('title', event.target.value)} /></Field><Field label="Category" required><select value={draft.category} onChange={(event) => update('category', event.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Assigned person or committee" optional><input value={draft.handler} onChange={(event) => update('handler', event.target.value)} /></Field><Field label="Person making the complaint" required><input value={draft.filedBy} onChange={(event) => update('filedBy', event.target.value)} /></Field><Field label="Person or group the complaint concerns" required><input value={draft.concerns} onChange={(event) => update('concerns', event.target.value)} /></Field><Field label="Affected lot" optional><input list="lot-suggestions" value={draft.lot} onChange={(event) => update('lot', event.target.value)} placeholder="e.g. B3 · L07" /><datalist id="lot-suggestions"><option value="A1 · L12" /><option value="B3 · L07" /><option value="C2 · L03" /></datalist></Field><Field label="Location or common area" required><input value={draft.location} onChange={(event) => update('location', event.target.value)} /></Field><Field label="Incident date" optional><input type="date" max={TODAY} value={draft.incidentDate} onChange={(event) => update('incidentDate', event.target.value)} /></Field><Field label="Next follow-up date" optional><input type="date" value={draft.followUp} onChange={(event) => update('followUp', event.target.value)} /></Field><Field label="What happened?" required wide><textarea rows={4} value={draft.description} onChange={(event) => update('description', event.target.value)} /></Field><Field label="What action is requested?" optional wide><textarea rows={3} value={draft.requestedAction} onChange={(event) => update('requestedAction', event.target.value)} /></Field><Field label={editing ? 'Update note' : 'Filing note'} required wide><textarea rows={3} value={editing ? (draft.updateNote || '') : (draft.filingNote || '')} onChange={(event) => update(editing ? 'updateNote' : 'filingNote', event.target.value)} /></Field></div>{error && <p className="form-error" role="alert">{error}</p>}<footer className="dialog-footer"><button className="button-outline" type="button" onClick={onClose}>Cancel</button><button className="button-primary" type="submit" style={{ backgroundColor: '#1464a0', borderColor: '#1464a0', color: '#fff' }}>{editing ? 'Save changes' : 'Record grievance'}</button></footer></form></Dialog> }
function Dialog({ children, className, label, onClose, backdropClose = false }) { const ref = useRef(null); useEffect(() => { ref.current?.querySelector('input,textarea,select,button')?.focus() }, []); function trap(event) { if (event.key !== 'Tab') return; const nodes = [...ref.current.querySelectorAll('button,input,select,textarea')].filter((node) => !node.disabled); const first = nodes[0]; const last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } } return <div className="modal-overlay" onMouseDown={(event) => { if (backdropClose && event.target === event.currentTarget) onClose() }}><section ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={trap}>{children}</section></div> }

const styles = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
.grievance-app{--blue:#1464a0;--dark:#0f3f6a;--ink:#071e30;--body:#2a5470;--muted:#5a7a92;--line:#d0e4f0;--green:#1a8a60;--amber:#d49206;--red:#c0392b;width:100%;min-height:100%;padding:32px;box-sizing:border-box;color:var(--body);font-family:'IBM Plex Sans',sans-serif;background:linear-gradient(135deg,#e6f0fa,#f0f5fa)}
.grievance-app *,.grievance-app *:before,.grievance-app *:after{box-sizing:border-box}.grievance-app button,.grievance-app input,.grievance-app select,.grievance-app textarea{font:inherit}.grievance-app button{cursor:pointer}.grievance-app button:focus-visible,.grievance-app input:focus-visible,.grievance-app select:focus-visible,.grievance-app textarea:focus-visible{outline:3px solid #1464a047;outline-offset:2px}.grievance-hero{display:flex;align-items:center;justify-content:space-between;gap:28px;padding:30px 34px;border:1px solid #bdd9ec;border-radius:28px;background:linear-gradient(110deg,#fff 5%,#e3f0fd);box-shadow:0 18px 42px #0f3f6a1f}.grievance-eyebrow,.drawer-kicker{margin:0;color:var(--blue);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}.grievance-hero h1{margin:5px 0;color:var(--ink);font-size:34px;line-height:1.1}.grievance-subtitle{margin:0;color:var(--muted);font-size:18px}.grievance-actions,.case-meta{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.button-outline,.button-primary{display:inline-flex;min-height:44px;align-items:center;justify-content:center;gap:8px;padding:10px 16px;border:1px solid #b9d1e2;border-radius:11px;background:#fff;color:var(--dark);font-weight:600;transition:transform .2s,box-shadow .2s}.button-primary{border-color:var(--blue);background:var(--blue);color:#fff;box-shadow:0 8px 18px #1464a033}.button-outline:hover,.button-primary:hover{transform:translateY(-1px);box-shadow:0 8px 18px #0f3f6a24}.grievance-tabs{display:flex;gap:26px;margin:22px 4px 18px;border-bottom:1px solid #c7dce9}.grievance-tabs button{position:relative;border:0;padding:0 2px 12px;background:transparent;color:var(--muted);font-weight:600}.grievance-tabs button:after{position:absolute;right:0;bottom:-1px;left:0;height:3px;border-radius:3px;background:var(--blue);content:'';transform:scaleX(0);transition:transform .25s}.grievance-tabs button.is-active{color:var(--blue)}.grievance-tabs button.is-active:after{transform:scaleX(1)}.grievance-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}.stat-card{min-width:0;padding:18px 20px;border:1px solid #cfe2ee;border-radius:18px;background:#fff;color:var(--body);text-align:left;box-shadow:0 10px 24px #0f3f6a14;transition:transform .2s,box-shadow .2s}.stat-card:hover{transform:translateY(-3px);box-shadow:0 16px 30px #0f3f6a21}.stat-card.is-selected{border:2px solid var(--blue);padding:17px 19px;box-shadow:0 0 0 3px #1464a01a}.stat-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase}.stat-icon{display:grid;width:32px;height:32px;flex:0 0 32px;place-items:center;border-radius:10px;background:#e9f3fb;color:var(--blue)}.stat-icon.amber{background:#fff5da;color:var(--amber)}.stat-icon.red{background:#fff0ee;color:var(--red)}.stat-icon.green{background:#eaf7f0;color:var(--green)}.stat-card strong{display:block;margin-top:12px;color:var(--ink);font-size:30px;line-height:1.1}.stat-card .danger-number{color:var(--red)}.stat-card small{display:block;min-height:20px;margin-top:6px;color:var(--muted);font-size:12px}.progress-track{display:block;height:5px;margin-top:13px;overflow:hidden;border-radius:99px;background:#e2eee8}.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--green);transition:width .3s}.register-panel{overflow:hidden;border:1px solid #cfe2ee;border-radius:18px;background:#fff;box-shadow:0 12px 28px #0f3f6a14}.status-chips{display:flex;flex-wrap:wrap;gap:8px;padding:18px 20px 10px}.status-chips button{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid #cfe2ee;border-radius:99px;background:#f7fbfe;color:var(--body);font-size:12px;font-weight:600}.status-chips button span{display:grid;min-width:20px;height:20px;place-items:center;border-radius:99px;background:#e1edf5;color:var(--dark);font-size:11px}.status-chips button.is-active{border-color:var(--blue);background:var(--blue);color:#fff}.status-chips button.is-active span{background:#ffffff33;color:#fff}.status-chips button.is-danger{border-color:var(--red);background:var(--red)}.filter-bar{position:sticky;top:0;z-index:4;display:grid;grid-template-columns:minmax(240px,1fr) 180px 180px auto;align-items:center;gap:10px;padding:10px 20px 16px;background:#fffffff5;border-bottom:1px solid #e1edf4}.filter-bar label{min-width:0}.filter-bar select,.search-field{width:100%;height:42px;border:1px solid #c5dbe9;border-radius:10px;background:#fff;color:var(--body)}.filter-bar select{padding:0 11px}.search-field{display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--blue)}.search-field input{width:100%;min-width:0;border:0;outline:0;color:var(--ink)}.search-field kbd{padding:2px 6px;border:1px solid #c5dbe9;border-radius:5px;color:var(--muted);font-size:11px}.clear-link{border:0;background:transparent;color:var(--blue);font-size:12px;font-weight:700;white-space:nowrap}.case-heading,.case-row{display:grid;grid-template-columns:100px minmax(230px,1.7fr) 100px 130px 125px 120px 24px;gap:14px;align-items:center}.case-heading{padding:13px 20px;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}.case-row{position:relative;width:100%;border:0;border-top:1px solid #e5eef4;padding:16px 20px;background:#fff;color:var(--body);text-align:left;transition:background .2s,padding-left .2s}.case-row:before{position:absolute;top:0;bottom:0;left:0;width:3px;background:var(--blue);content:'';opacity:0;transition:opacity .2s}.case-row:hover{padding-left:24px;background:#f6fbff}.case-row:hover:before{opacity:1}.case-row>span{min-width:0}.case-id strong,.case-title strong{display:block;color:var(--ink);font-size:13px}.case-id small,.case-title small{display:block;margin-top:4px;color:var(--muted);font-size:11px;line-height:1.35}.case-title small b{color:#9ab4c6;font-weight:400}.follow-up{display:flex;align-items:center;gap:5px;font-size:12px}.is-overdue{color:var(--red)!important;font-weight:700}.follow-up.is-soon{color:var(--amber);font-weight:700}.status-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:99px;background:#fff5da;color:#916303;font-size:11px;font-weight:700;white-space:nowrap}.status-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}.status-pill.in-progress{background:#e8f1fb;color:var(--blue)}.status-pill.resolved{background:#e8f7ef;color:var(--green)}.row-chevron{color:#8caabd;transition:transform .2s}.case-row:hover .row-chevron{transform:translateX(4px)}.table-footer{display:flex;justify-content:space-between;gap:12px;padding:14px 20px;border-top:1px solid #e5eef4;color:var(--muted);font-size:12px}.empty-state,.statement-placeholder{padding:50px 20px;text-align:center;color:var(--muted)}.empty-state h2,.statement-placeholder h2{margin:14px 0 5px;color:var(--ink);font-size:20px}.empty-state p,.statement-placeholder p{margin:0 auto 18px;font-size:13px}.statement-placeholder{border:1px solid #cfe2ee;border-radius:18px;background:#fff;box-shadow:0 12px 28px #0f3f6a14}.statement-icon{display:inline-grid;width:42px;height:42px;place-items:center;border-radius:13px;background:#e9f3fb;color:var(--blue)}.modal-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto;background:#0f3f6a80;backdrop-filter:blur(8px);animation:fade-in .35s ease both}.dialog{width:min(960px,100%);max-height:calc(100vh - 48px);overflow:auto;border:1px solid #c5dfed;border-radius:20px;background:#edf6fd;box-shadow:0 24px 70px #071e3052;animation:dialog-in .35s ease both}.form-dialog{width:min(780px,100%);background:#fff}.dialog-top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:26px 30px;border-bottom:1px solid #d5e6f0;background:linear-gradient(120deg,#fff,#e6f3fd)}.dialog-top h2{margin:6px 0 12px;color:var(--ink);font-size:28px;line-height:1.2}.icon-button{display:grid;width:36px;height:36px;flex:0 0 36px;place-items:center;border:1px solid #c5dbe9;border-radius:10px;background:#fff;color:var(--dark)}.case-meta{color:var(--muted);font-size:12px}.case-dialog-grid{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(280px,.8fr);gap:18px;padding:20px}.dialog-card{margin-bottom:16px;padding:18px;border:1px solid #d2e4ef;border-radius:14px;background:#fff;box-shadow:0 6px 16px #0f3f6a0d}.dialog-card h3{margin:0 0 12px;color:var(--dark);font-size:14px}.dialog-card p{margin:0;color:var(--body);font-size:13px;line-height:1.6;white-space:pre-wrap}.segmented-status{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:16px;padding:4px;border-radius:10px;background:#edf5fa}.segmented-status button{padding:9px 5px;border:0;border-radius:7px;background:transparent;color:var(--muted);font-size:11px;font-weight:700}.segmented-status button.is-active{background:#fff;color:var(--blue);box-shadow:0 2px 7px #0f3f6a1f}.segmented-status button.is-active.resolved{color:var(--green)}.form-field{display:flex;min-width:0;flex-direction:column;gap:6px}.form-field span{color:var(--body);font-size:12px;font-weight:700}.form-field em{color:var(--muted);font-size:11px;font-style:normal;font-weight:400}.form-field input,.form-field select,.form-field textarea{width:100%;border:1px solid #c5dbe9;border-radius:9px;padding:10px 11px;background:#fff;color:var(--ink);font-size:13px}.form-field textarea{resize:vertical}.details-list{margin:0}.details-list div{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid #e1edf4}.details-list dt{color:var(--muted);font-size:12px}.details-list dd{margin:0;color:var(--ink);font-size:13px;font-weight:600;overflow-wrap:anywhere}.timeline{border-left:2px solid #cce0ec;padding-left:17px}.timeline article{position:relative;padding:0 0 17px}.timeline-dot{position:absolute;top:3px;left:-24px;width:10px;height:10px;border:2px solid #fff;border-radius:50%;background:var(--blue);box-shadow:0 0 0 2px #cce0ec}.timeline strong,.timeline small,.timeline p{display:block}.timeline strong{color:var(--ink);font-size:13px}.timeline small{margin-top:3px;color:var(--muted);font-size:11px}.timeline p{margin-top:6px;font-size:12px}.dialog-footer{display:flex;justify-content:flex-end;gap:10px;padding:18px 30px;border-top:1px solid #d5e6f0}.full-button{width:100%}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:24px 30px}.form-field.wide{grid-column:1/-1}.form-error{margin:0 30px 16px;padding:10px 12px;border:1px solid #efc3bd;border-radius:9px;background:#fff0ee;color:var(--red);font-size:12px}.form-dialog form>.dialog-footer{padding-top:0;border-top:0}.grievance-toast{position:fixed;right:28px;bottom:28px;z-index:70;padding:12px 16px;border-radius:10px;background:var(--dark);color:#fff;font-size:13px;box-shadow:0 12px 28px #0f3f6a40;animation:toast-in .25s ease both}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}@keyframes fade-in{from{opacity:0}to{opacity:1}}@keyframes dialog-in{from{opacity:0;transform:scale(.97) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
+@media(max-width:1050px){.grievance-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.case-heading,.case-row{grid-template-columns:90px minmax(200px,1fr) 85px 110px 110px 105px 20px;gap:9px}}@media(max-width:720px){.grievance-app{padding:18px}.grievance-hero{align-items:flex-start;flex-direction:column;padding:24px}.grievance-subtitle{font-size:15px}.grievance-actions{width:100%}.grievance-actions button{flex:1}.filter-bar{grid-template-columns:1fr 1fr}.search-field{grid-column:1/-1}.case-heading{display:none}.case-row{grid-template-columns:1fr auto;gap:5px 12px;padding:15px}.case-row:hover{padding-left:19px}.case-row>span:nth-child(1){grid-column:1;grid-row:2}.case-row>span:nth-child(2){grid-column:1;grid-row:1}.case-row>span:nth-child(3),.case-row>span:nth-child(4),.case-row>span:nth-child(5){grid-column:auto;grid-row:2;color:var(--muted);font-size:11px}.case-row>span:nth-child(3):before{content:'Lot ';font-weight:700}.case-row>span:nth-child(4):before{content:'· Handler ';font-weight:700}.case-row>span:nth-child(5):before{content:'· Follow-up ';font-weight:700}.case-row>span:nth-child(6){grid-column:2;grid-row:1;justify-self:end}.case-row>span:nth-child(7){grid-column:2;grid-row:2;justify-self:end}.case-title small{display:none}.case-id small{display:inline;margin-left:6px}.table-footer{flex-direction:column}.case-dialog-grid{grid-template-columns:1fr}.dialog-top,.drawer-body,.dialog-footer,.form-grid{padding-right:20px;padding-left:20px}.form-error{margin-right:20px;margin-left:20px}}@media(max-width:480px){.grievance-app{padding:12px}.grievance-hero h1{font-size:29px}.grievance-stats{grid-template-columns:1fr}.filter-bar{grid-template-columns:1fr}.search-field{grid-column:auto}.status-chips{padding-right:12px;padding-left:12px}.case-row>span:nth-child(3),.case-row>span:nth-child(4),.case-row>span:nth-child(5){font-size:10px}.case-row>span:nth-child(5){display:none}.dialog-top h2{font-size:23px}.dialog{max-height:calc(100vh - 24px)}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
.grievance-app{padding:0;background:transparent;border:0;box-shadow:none}
.grievance-app .grievance-hero{flex-wrap:wrap;gap:18px;padding:24px 28px}
.grievance-app .grievance-hero>div:first-child{flex:1 1 380px;min-width:0}
.grievance-app .grievance-actions{flex:1 1 410px;justify-content:flex-end;min-width:0}
.grievance-app .grievance-actions button{white-space:nowrap}
.grievance-cloud-info{margin:12px 0 18px;display:grid;gap:8px}
.grievance-cloud-status{margin:0;padding:11px 14px;border:1px solid #bfd7e9;border-radius:11px;background:#f5faff;color:#345c79;font-size:14px;line-height:1.5}
.grievance-cloud-preview{padding:11px 14px;border:1px solid #cbdde9;border-radius:11px;background:#fff;font-size:14px}
.grievance-cloud-preview summary{cursor:pointer;font-weight:600}
.grievance-cloud-preview ul{padding-left:20px}
@media(max-width:900px){.grievance-app .grievance-actions{justify-content:flex-start;flex:1 1 100%}}
@media(max-width:600px){.grievance-app .grievance-hero{padding:20px}.grievance-app .grievance-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.grievance-app .grievance-actions button:last-child{grid-column:1/-1}.grievance-app .grievance-actions button{white-space:normal}}
/* Cloud grievance modal only. Existing local grievance modals are unaffected. */
.gc-modal-content{display:flex;flex-direction:column;max-height:90dvh;min-height:0;width:100%;background:#f8fbff;color:#2a5470;font-family:'DM Sans',sans-serif}
.gc-modal-content *{box-sizing:border-box}
.gc-header,.gc-footer{flex:0 0 auto;background:#f8fbff;padding:16px 22px}
.gc-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:1px solid #d0e4f0}
.gc-header-copy{min-width:0}
.gc-header h2{margin:0;color:#071e30;font-size:22px;line-height:1.25}
.gc-header p{margin:4px 0 0;color:#5a7a92;font-size:13px;line-height:1.4}
.gc-icon-close{min-width:44px;height:44px;border:1px solid #c9dbe8;border-radius:10px;background:#fff;color:#0f3f6a;font-size:27px;cursor:pointer;flex-shrink:0}
.gc-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:16px 22px;overscroll-behavior:contain}
.gc-footer{display:flex;justify-content:flex-end;gap:10px;border-top:1px solid #d0e4f0}
.gc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 16px}
.gc-field{display:flex;flex-direction:column;min-width:0;gap:6px;font-size:13px;font-weight:600;color:#345d78}
.gc-field--wide{grid-column:1/-1}
.gc-field input,.gc-field select,.gc-field textarea{min-width:0;width:100%;border:1px solid #a8bacb;border-radius:9px;background:#fff;color:#071e30;font:inherit;font-size:14px;padding:9px 12px;outline-offset:2px}
.gc-field input,.gc-field select{height:44px;min-height:44px;max-height:44px}
.gc-field textarea{min-height:96px;resize:vertical}
.gc-field input:focus-visible,.gc-field select:focus-visible,.gc-field textarea:focus-visible,.gc-button:focus-visible,.gc-icon-close:focus-visible{outline:3px solid #1464a055}
.gc-button{min-height:44px;padding:10px 16px;border-radius:10px;font:inherit;font-size:14px;font-weight:650;cursor:pointer}
.gc-button-primary{border:1px solid #1464a0;background:#1464a0;color:#fff}
.gc-button-secondary{border:1px solid #b8d0e0;background:#fff;color:#0f3f6a}
.gc-button:disabled,.gc-icon-close:disabled{opacity:.6;cursor:not-allowed}
.gc-error{margin:14px 0 0;padding:12px 14px;border:1px solid #e6a8a8;border-radius:10px;background:#fff3f2;color:#a12626;line-height:1.5}
.gc-review-intro{margin-top:0}
.gc-summary{display:grid;grid-template-columns:minmax(110px,190px) minmax(0,1fr);gap:10px 16px;overflow-wrap:anywhere}
.gc-summary dt{font-weight:650;color:#345d78}
.gc-summary dd{margin:0;white-space:pre-wrap;color:#071e30}
.gc-success{text-align:center;max-width:660px;margin:0 auto}
.gc-success-icon{display:inline-grid;place-items:center;width:62px;height:62px;border-radius:50%;background:#e3f5eb;color:#167247;font-size:32px;font-weight:bold}
.gc-success h3{color:#071e30;font-size:24px;margin:14px 0 8px}
.gc-success>p{line-height:1.55}
.gc-success .gc-summary{text-align:left;margin-top:22px;padding:18px;background:#fff;border:1px solid #d0e4f0;border-radius:12px}
@media(max-width:900px){.gc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:639px){.gc-grid{grid-template-columns:minmax(0,1fr)}.gc-header,.gc-footer{padding:12px 14px}.gc-body{padding:14px}.gc-header h2{font-size:19px}.gc-footer{flex-wrap:wrap}.gc-footer .gc-button{flex:1 1 120px}.gc-summary{grid-template-columns:1fr;gap:4px}.gc-summary dd{margin-bottom:10px}}

`.replace(/^\+/gm, '')
