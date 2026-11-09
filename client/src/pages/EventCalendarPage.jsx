import { useSuccessNotice } from '../lib/useSuccessNotice'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../components/Select'
import {
  Clock,
  Edit,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import {
  calendarToday, calendarMonthDays, shiftCalendarMonth, calendarFormValues,
  isCalendarDate, validateCalendarForm, loadCalendarEvents, saveCalendarEvent,
  deleteCalendarEvent, preserveCalendarTimePrecision, summarizeCalendarEvents,
  compareCalendarEvents, matchesCalendarSearch,
} from '../lib/eventCalendar'
import ActionDialog from '../components/ActionDialog'
import Skeleton from '../components/skeleton/Skeleton'
import useAnimatedPopover from '../hooks/useAnimatedPopover'
import './EventCalendarPage.css'

const EMPTY_FORM = {
  title: '',
  eventDate: '',
  startTime: '',
  endTime: '',
  location: '',
  description: '',
}

const eventDateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'full',
  timeZone: 'UTC',
})

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  timeZone: 'UTC',
})

const fullMonthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS = 2

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  timeZone: 'UTC',
})

function EventDatePicker({ value, onChange, disabled }) {
  const picker = useAnimatedPopover()
  const [cursor, setCursor] = useState(value ? value.slice(0, 7) : manilaToday().slice(0, 7))
  const pickerRef = React.useRef(null)
  const triggerRef = useRef(null)
  const pickerId = React.useId()
  useEffect(() => { if (value) setCursor(value.slice(0, 7)) }, [value])
  const days = calendarMonthDays(cursor)

  useEffect(() => {
    function closeOnOutside(event) {
      if (!pickerRef.current?.contains(event.target)) picker.hide()
    }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [picker])

  function selectDate(dateKey) {
    onChange({ target: { name: 'eventDate', value: dateKey } })
    picker.hide()
    triggerRef.current?.focus()
  }

  return (
    <div className="cal-date-picker" ref={pickerRef}>
      <button
        type="button"
        ref={triggerRef}
        aria-label="Event date"
        aria-controls={pickerId}
        onKeyDown={(event) => { if (event.key === 'Escape' && picker.open) { event.preventDefault(); event.stopPropagation(); picker.hide() } }}
        className={`cal-date-trigger ${picker.open ? 'is-open' : ''}`}
        onClick={picker.toggle}
        disabled={disabled}
        aria-expanded={picker.open}
        aria-haspopup="dialog"
      >
        <span>{value ? calendarDate(value).toLocaleDateString('en-PH', { timeZone: 'UTC' }) : 'Select event date'}</span>
        <span className="cal-date-trigger-icon" aria-hidden="true">▣</span>
      </button>
      {picker.mounted && (
        <div className={`cal-date-popover ${picker.visible ? 'is-visible' : ''}`} id={pickerId} role="dialog" aria-label="Select event date" aria-hidden={!picker.open} inert={picker.open ? undefined : ''}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.hide(); triggerRef.current?.focus() } }}>
          <div className="cal-date-popover-header">
            <button type="button" onClick={() => setCursor(shiftCalendarMonth(cursor, -1))} aria-label="Previous month">‹</button>
            <strong>{fullMonthFormatter.format(calendarDate(`${cursor}-01`))}</strong>
            <button type="button" onClick={() => setCursor(shiftCalendarMonth(cursor, 1))} aria-label="Next month">›</button>
          </div>
          <div className="cal-date-weekdays">
            {Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(Date.UTC(2026, 0, 4 + index)))).map((day) => (
              <span key={day}>{day.slice(0, 2)}</span>
            ))}
          </div>
          <div className="cal-date-grid">
            {days.map((day) => (
              <button
                key={day.key}
                type="button"
                className={`${day.outside ? 'is-outside' : ''} ${day.key === value ? 'is-selected' : ''}`}
                disabled={!isCalendarDate(day.key)}
                aria-label={day.key}
                aria-pressed={day.key === value}
                onClick={() => selectDate(day.key)}
              >
                {day.day}
              </button>
            ))}
          </div>
          <button type="button" className="cal-date-today" onClick={() => selectDate(manilaToday())}>Today</button>
        </div>
      )}
    </div>
  )
}

function manilaToday() { return calendarToday() }

// PostgreSQL DATE is a civil calendar day, not a timezone-converted instant.
function calendarDate(date) {
  return new Date(`${date}T00:00:00Z`)
}

function formatTime(time) {
  if (!time) return ''

  const [hourValue, minute = '00', second = '00'] = time.split(':')
  const hour = Number(hourValue)

  if (Number.isNaN(hour)) return time

  const period = hour % 24 >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute}${Number(second) ? `:${second}` : ''} ${period}${hour === 24 ? ' (next day)' : ''}`
}

function formatTimeRange(event) {
  if (!event.start_time) return 'Time to be announced'
  if (!event.end_time) return formatTime(event.start_time)

  return `${formatTime(event.start_time)} – ${formatTime(event.end_time)}`
}

const TIME_HOURS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, '0'),
)

const TIME_MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, '0'),
)

function timeParts(value) {
  if (!value) return { hour: '', minute: '', period: '' }

  const [hourValue, minute = '00'] = value.split(':')
  const hour = Number(hourValue)

  if (Number.isNaN(hour)) return { hour: '', minute: '', period: '' }

  return {
    hour: String(hour % 12 || 12).padStart(2, '0'),
    minute: minute.slice(0, 2),
    period: hour % 24 >= 12 ? 'PM' : 'AM',
  }
}

function timeValue({ hour, minute, period }) {
  const hour12 = Number(hour || '12')
  const hour24 = (hour12 % 12) + (period === 'PM' ? 12 : 0)
  return `${String(hour24).padStart(2, '0')}:${minute || '00'}`
}

function TimeSegment({ value, placeholder, options, onChange, disabled, label }) {
  const picker = useAnimatedPopover()
  const segmentRef = React.useRef(null)
  const triggerRef = useRef(null)
  const optionsId = React.useId()

  useEffect(() => {
    function closeOnOutside(event) {
      if (!segmentRef.current?.contains(event.target)) picker.hide()
    }
    document.addEventListener('mousedown', closeOnOutside)
    return () => document.removeEventListener('mousedown', closeOnOutside)
  }, [picker])

  return (
    <div className="cal-time-segment" ref={segmentRef}>
      <button
        type="button"
        ref={triggerRef}
        aria-controls={optionsId}
        onKeyDown={(event) => { if (event.key === 'Escape' && picker.open) { event.preventDefault(); event.stopPropagation(); picker.hide() } }}
        className={`cal-time-segment-trigger ${picker.open ? 'is-open' : ''}`}
        onClick={picker.toggle}
        disabled={disabled}
        aria-label={`${label}: ${value || placeholder}`}
        aria-expanded={picker.open}
        aria-haspopup="listbox"
      >
        <span>{value || placeholder}</span>
        <span className="cal-time-segment-chevron" aria-hidden="true">⌄</span>
      </button>
      {picker.mounted && (
        <div className={`cal-time-options ${picker.visible ? 'is-visible' : ''}`} id={optionsId} role="listbox" aria-label={label} aria-hidden={!picker.open} inert={picker.open ? undefined : ''}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); picker.hide(); triggerRef.current?.focus() } }}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={option === value ? 'is-selected' : ''}
              onClick={() => {
                onChange(option)
                picker.hide()
                triggerRef.current?.focus()
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TimePicker({ label, name, value, onChange, disabled }) {
  const parts = timeParts(value)

  function updatePart(part, nextValue) {
    const nextParts = {
      hour: parts.hour || '12',
      minute: parts.minute || '00',
      period: parts.period || 'AM',
      [part]: nextValue,
    }

    onChange({ target: { name, value: preserveCalendarTimePrecision(value, timeValue(nextParts)) } })
  }

  function clearTime() {
    onChange({ target: { name, value: '' } })
  }

  return (
    <div className="cal-time-field">
      <div className="cal-time-label">
        <span>{label}{value.startsWith('24:') ? ' (next day)' : ''}</span>
        <span className="cal-optional-label">Optional</span>
      </div>

      <div className="cal-time-control">
        <Clock size={17} aria-hidden="true" />

        <TimeSegment
          value={parts.hour}
          placeholder="HH"
          options={TIME_HOURS}
          onChange={(nextValue) => updatePart('hour', nextValue)}
          disabled={disabled}
          label={`${label} hour`}
        />

        <span className="cal-time-separator" aria-hidden="true">
          :
        </span>

        <TimeSegment
          value={parts.minute}
          placeholder="MM"
          options={TIME_MINUTES}
          onChange={(nextValue) => updatePart('minute', nextValue)}
          disabled={disabled}
          label={`${label} minute`}
        />

        <TimeSegment
          value={parts.period}
          placeholder="AM/PM"
          options={['AM', 'PM']}
          onChange={(nextValue) => updatePart('period', nextValue)}
          disabled={disabled}
          label={`${label} period`}
        />

        {value && (
          <button
            type="button"
            className="cal-time-clear"
            onClick={clearTime}
            disabled={disabled}
            aria-label={`Clear ${label.toLowerCase()}`}
            title={`Clear ${label.toLowerCase()}`}
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

// Day pop-up: all events on one date, centered over a blurred backdrop (focus trap, Esc, focus return).
function DayModal({ day, count, canManage, busy, onClose, onAdd, children }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    const previous = document.activeElement
    document.documentElement.style.overflow = 'hidden'
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      document.documentElement.style.overflow = ''
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  function handleKeys(keyEvent) {
    if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault()
      onClose()
    } else if (keyEvent.key === 'Tab') {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled)')]
      if (!nodes.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (keyEvent.shiftKey && (active === first || active === dialogRef.current)) {
        keyEvent.preventDefault()
        last.focus()
      } else if (!keyEvent.shiftKey && active === last) {
        keyEvent.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="cal-day-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        className="cal-day-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cal-day-title"
        tabIndex={-1}
        onKeyDown={handleKeys}
      >
        <div className="cal-day-modal-head">
          <div>
            <p className="cal-eyebrow">{count === 1 ? '1 event' : `${count} events`}</p>
            <h2 id="cal-day-title">{eventDateFormatter.format(calendarDate(day))}</h2>
          </div>
          <button type="button" className="cal-day-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="cal-day-modal-body">
          {count === 0 ? <p className="cal-empty">No events on this day.</p> : children}
        </div>

        <div className="cal-day-modal-foot">
          <button type="button" className="cal-refresh-button" onClick={onClose}>Close</button>
          {canManage && (
            <button type="button" className="cal-primary-button" onClick={onAdd} disabled={busy}>
              <Plus size={18} />
              Add event
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EventCalendarPage({ user: suppliedUser }) {
  const [resolvedUser, setResolvedUser] = useState(null)
  const currentUser = suppliedUser || resolvedUser
  const [events, setEvents] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('upcoming')
  const [view, setView] = useState('list')
  const [cursor, setCursor] = useState(() => manilaToday().slice(0, 7))
  const [dayOpen, setDayOpen] = useState(false)
  const [selectedDay, setSelectedDay] = useState(() => manilaToday())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [loadError, setLoadError] = useState(false)
  const [today, setToday] = useState(manilaToday)
  const request = useRef(0)
  const mounted = useRef(false)
  const busy = useRef(false)
  const modalRef = useRef(null)
  const [notice, setNotice] = useSuccessNotice()
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [creationId, setCreationId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [highlightedEventId, setHighlightedEventId] = useState(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageEvents = role === 'secretary' && currentUser?.is_active === true
  useEffect(() => {
    mounted.current = true
    loadEvents()
    const tick = () => setToday(manilaToday())
    const refreshOnFocus = () => {
      tick()
      void loadEvents(true)
    }
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      mounted.current = false
      request.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setResolvedUser(null)
    setAccountError('')
    async function resolve() {
      if (suppliedUser) return
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!data.user) throw new Error('Sign in again to verify your calendar access.')
        const result = await supabase.from('profiles').select('id, full_name, email, role, is_active').eq('id', data.user.id).single()
        if (result.error) throw result.error
        if (!cancelled && mounted.current) setResolvedUser(result.data)
      } catch (error) {
        if (!cancelled && mounted.current) setAccountError(`Calendar account could not be verified: ${error.message}`)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [suppliedUser])

  useEffect(() => {
    if (!showForm) return undefined
    const previous = document.activeElement
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    modalRef.current?.querySelector('input')?.focus()
    return () => {
      document.documentElement.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [showForm])

  useEffect(() => {
    if (saving) modalRef.current?.focus()
  }, [saving])

  async function loadEvents(isRefresh = false) {
    if (busy.current) return
    const sequence = ++request.current
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setPageError('')
    try {
      const data = await loadCalendarEvents(supabase)
      if (!mounted.current || sequence !== request.current) return
      setEvents(data)
      setLoadError(false)
    } catch (error) {
      if (!mounted.current || sequence !== request.current) return
      setEvents([])
      setLoadError(true)
      setPageError(`Events could not be loaded: ${error.message || 'Connection failed.'}`)
    } finally {
      if (mounted.current && sequence === request.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  function startMutation() {
    request.current += 1
    setLoading(false)
    setRefreshing(false)
    busy.current = true
  }

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  function openCreateForm(date = manilaToday()) {
    if (!canManageEvents || busy.current) return
    const id = globalThis.crypto?.randomUUID?.()
    if (!id) { setPageError('Open the app over HTTPS or localhost before scheduling an event.'); return }
    setCreationId(id)
    setEditingEvent(null)
    setForm({
      ...EMPTY_FORM,
      eventDate: date,
    })
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function openEditForm(event) {
    setDayOpen(false)
    if (!canManageEvents || busy.current) return
    setEditingEvent(event)
    setForm(calendarFormValues(event))
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setEditingEvent(null)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  async function saveEvent(event) {
    event.preventDefault()
    if (!canManageEvents || !currentUser?.id) { setFormError('Only a verified Secretary can manage events.'); return }
    if (busy.current) return
    const validation = validateCalendarForm(form)
    if (validation.error) { setFormError(validation.error); return }
    startMutation()
    setSaving(true)
    setFormError('')
    try {
      const savedEvent = await saveCalendarEvent(supabase, validation.payload, editingEvent, currentUser, creationId)
      if (!mounted.current) return
      // A retry can return an event already loaded by a refresh.
      setEvents((current) => [...current.filter((item) => item.id !== savedEvent.id), savedEvent].sort(compareCalendarEvents))
      const savedToday = manilaToday()
      setToday(savedToday)
      const savedFilter = savedEvent.event_date < savedToday ? 'past' : 'upcoming'
      if (statusFilter !== 'all' && statusFilter !== savedFilter) setStatusFilter(savedFilter)
      if (!matchesCalendarSearch(savedEvent, search)) setSearch('')
      setHighlightedEventId(savedEvent.id)
      setShowForm(false)
      setEditingEvent(null)
      setForm(EMPTY_FORM)
      setNotice(editingEvent ? `“${savedEvent.title}” was updated.` : `“${savedEvent.title}” was scheduled.`)
    } catch (error) {
      if (mounted.current) setFormError(`${error.message || 'The event could not be saved.'} Refresh if the result is uncertain before starting another scheduling attempt.`)
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
  }

  function requestDeleteEvent(event) {
    setDayOpen(false)
    if (!canManageEvents || !currentUser?.id || busy.current) return
    setPendingDelete(event)
  }

  async function deleteEvent(event) {
    if (!event || !canManageEvents || !currentUser?.id || busy.current) return
    startMutation()
    setPendingDelete(null)
    setDeletingId(event.id)
    setPageError('')
    setNotice('')
    try {
      await deleteCalendarEvent(supabase, event)
      if (!mounted.current) return
      setEvents((current) => current.filter((item) => item.id !== event.id))
      setNotice(`“${event.title}” was deleted.`)
    } catch (error) {
      if (mounted.current) setPageError(`Event could not be deleted: ${error.message || 'Connection failed.'}`)
    } finally {
      busy.current = false
      if (mounted.current) setDeletingId(null)
    }
  }

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => {
        const isUpcoming = event.event_date >= today
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'upcoming' && isUpcoming) ||
          (statusFilter === 'past' && !isUpcoming)
        return matchesStatus && matchesCalendarSearch(event, search)
      })
      .sort((left, right) => {
        const comparison = compareCalendarEvents(left, right)
        return statusFilter === 'past' ? -comparison : comparison
      })
  }, [events, search, statusFilter, today])

  // The month view ignores the status filter (it shows past and upcoming) but still respects search.
  const eventsByDay = useMemo(() => {
    const term = normalize(search)
    const grouped = new Map()
    events
      .filter((event) => !term || [event.title, event.location, event.description].some((value) => normalize(value).includes(term)))
      .sort((left, right) => eventSortValue(left).localeCompare(eventSortValue(right)))
      .forEach((event) => grouped.set(event.event_date, [...(grouped.get(event.event_date) || []), event]))
    return grouped
  }, [events, search])
  const monthDays = useMemo(() => calendarMonthDays(cursor), [cursor])
  const selectedEvents = eventsByDay.get(selectedDay) || []
  const actionsLocked = Boolean(deletingId) || saving || refreshing

  function goToToday() {
    setCursor(today.slice(0, 7))
    setSelectedDay(today)
  }

  const calendarStats = useMemo(() => {
    const nextDate = new Date(`${today}T00:00:00Z`)
    nextDate.setUTCDate(nextDate.getUTCDate() + 7)
    const nextSevenDays = nextDate.toISOString().slice(0, 10)
    const thisMonth = today.slice(0, 7)
    return {
      thisMonth: filteredEvents.filter((event) => event.event_date.startsWith(thisMonth)).length,
      upcoming: filteredEvents.filter((event) => event.event_date >= today && event.event_date < nextSevenDays).length,
      today: filteredEvents.filter((event) => event.event_date === today).length,
      completed: filteredEvents.filter((event) => event.event_date < today).length,
    }
  }, [filteredEvents, today])

  return (
    <div className="cal-page">
      <header className="cal-header">
        <div>
          <p className="cal-eyebrow">{canManageEvents ? 'Secretary workspace' : 'Community calendar'}</p>
          <h1>Event Calendar</h1>
          <p>{canManageEvents ? 'Schedule and manage community meetings and events.' : 'View community meetings and events. Calendar changes are managed by the Secretary.'}</p>
        </div>

        <div className="cal-header-actions">
          <button
            type="button"
            className="cal-refresh-button"
            onClick={() => loadEvents(true)}
            disabled={refreshing || loading || saving || Boolean(deletingId)}
          >
            <RefreshCw size={17} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {canManageEvents && (
            <button
              type="button"
              className="cal-primary-button"
              onClick={() => openCreateForm()}
              disabled={loading || refreshing || loadError || saving || Boolean(deletingId)}
            >
              <Plus size={18} />
              Schedule Event
            </button>
          )}
        </div>
      </header>

      <section className="cal-summary" aria-label="Event summaries" aria-busy={loading || refreshing}>
        {[
          ['Events This Month', calendarStats.thisMonth, 'All events this calendar month', 'cal-stat-blue'],
          ['Next 7 Days', calendarStats.nextSevenDays, 'Tomorrow through the next 7 days', 'cal-stat-green'],
          ["Today's Events", calendarStats.today, 'Philippine time', 'cal-stat-warning'],
          ['Past Events', calendarStats.past, 'Scheduled dates before today', 'cal-stat-muted'],
        ].map(([label, value, footer, tone]) => (
          <article className="cal-stat-card" key={label}>
            <div className="cal-stat-top"><span>{label}</span><span className={`cal-stat-icon ${tone}`}><Clock size={18} /></span></div>
            <strong>{loading || refreshing ? '—' : loadError ? 'Unavailable' : value.toLocaleString('en-PH')}</strong>
            <small>{footer}</small>
          </article>
        ))}
      </section>

      <div className={`cal-toolbar ${view === 'month' ? 'cal-toolbar-month' : ''}`}>
        <label className="cal-search">
          <Search size={18} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by event, location, or description..."
            aria-label="Search events"
          />
        </label>

        <div className="cal-view-toggle" role="group" aria-label="Event view">
          <button type="button" className={view === 'list' ? 'is-active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          <button type="button" className={view === 'month' ? 'is-active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>Calendar</button>
        </div>

        {view === 'list' && (
          <Select ariaLabel="Filter events by status" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'upcoming', label: 'Upcoming Events' }, { value: 'past', label: 'Past Events' }, { value: 'all', label: 'All Events' }]} />
        )}
      </div>

      {accountError && <p className="cal-message cal-error" role="alert">{accountError}</p>}
      {pageError && <p className="cal-message cal-error" role="alert">{pageError}</p>}
      <section className="cal-list glass-card" aria-live="polite">
        {loading ? (
          <div className="cal-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="72px" /><Skeleton variant="rect" width="100%" height="72px" /><Skeleton variant="rect" width="100%" height="72px" /><span className="skeleton-region-status" role="status">Loading</span></div>
        ) : loadError ? (
          <div className="cal-empty"><p>Calendar data is unavailable.</p><button type="button" className="cal-refresh-button" onClick={() => loadEvents(true)} disabled={refreshing}>Retry</button></div>
        ) : filteredEvents.length === 0 ? (
          <p className="cal-empty">
            {events.length === 0
              ? 'No events have been scheduled yet.'
              : 'No events match your search or filter.'}
          </p>
        ) : (
          filteredEvents.map((event) => {
            const eventDate = calendarDate(event.event_date)
            const isPast = event.event_date < today

            return (
              <article
                key={event.id}
                className={`cal-row ${isPast ? 'cal-row-past' : ''}${event.id === highlightedEventId ? ' motion-record-highlight' : ''}`}
              >
                <div className="cal-date-badge" aria-hidden="true">
                  <span className="cal-month">
                    {monthFormatter.format(eventDate)}
                  </span>
                  <span className="cal-day">
                    {Number(event.event_date.slice(8, 10))}
                  </span>
                  <span className="cal-year">
                    {event.event_date.slice(0, 4)}
                  </span>
                </div>

                <div className="cal-info">
                  <div className="cal-title-row">
                    <h2>{event.title}</h2>
                    <span className={`cal-status ${isPast ? 'past' : 'upcoming'}`}>
                      {isPast ? 'Past' : 'Upcoming'}
                    </span>
                  </div>
                  <p className="cal-full-date">
                    {eventDateFormatter.format(eventDate)}
                  </p>
                  <div className="cal-meta">
                    <span>
                      <Clock size={16} />
                      {formatTimeRange(event)}
                    </span>
                    <span>
                      <MapPin size={16} />
                      {event.location || 'Location to be announced'}
                    </span>
                  </div>
                  {event.description && (
                    <p className="cal-description">{event.description}</p>
                  )}
                </div>

          <div className="cal-month-grid">
            {monthDays.map((day) => {
              const dayEvents = eventsByDay.get(day.key) || []
              const classes = ['cal-day-cell']
              if (day.outside) classes.push('is-outside')
              if (day.key === today) classes.push('is-today')
              if (day.key === selectedDay) classes.push('is-selected')
              return (
                <div key={day.key} className={classes.join(' ')} onClick={() => { setSelectedDay(day.key); setDayOpen(true) }}>
                  <button
                    type="button"
                    className="cal-day-number"
                    aria-haspopup="dialog"
                    aria-label={`${eventDateFormatter.format(calendarDate(day.key))}, ${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`}
                  >
                    {day.day}
                  </button>
                  {dayEvents.slice(0, MAX_CHIPS).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      className={`cal-chip ${event.event_date < today ? 'is-past' : ''}`}
                      title={event.title}
                      aria-haspopup="dialog"
                    >
                      {event.start_time && <b>{formatTime(event.start_time)}</b>}
                      {event.title}
                    </button>
                  ))}
                  {dayEvents.length > MAX_CHIPS && <span className="cal-more">+{dayEvents.length - MAX_CHIPS} more</span>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="cal-list glass-card" aria-live="polite" hidden={view === 'month' && !loading && !loadError}>
        {loading ? (
          <div className="cal-empty" aria-busy="true"><Skeleton variant="rect" width="100%" height="72px" /><Skeleton variant="rect" width="100%" height="72px" /><Skeleton variant="rect" width="100%" height="72px" /><span className="skeleton-region-status" role="status">Loading</span></div>
        ) : loadError ? (
          <div className="cal-empty"><p>Calendar data is unavailable.</p><button type="button" className="cal-refresh-button" onClick={() => loadEvents(true)} disabled={refreshing}>Retry</button></div>
        ) : filteredEvents.length === 0 ? (
          <p className="cal-empty">
            {events.length === 0
              ? 'No events have been scheduled yet.'
              : 'No events match your search or filter.'}
          </p>
        ) : (
          filteredEvents.map(renderEvent)
        )}
      </section>

      {dayOpen && (
        <DayModal
          day={selectedDay}
          count={selectedEvents.length}
          canManage={canManageEvents}
          busy={actionsLocked}
          onClose={() => setDayOpen(false)}
          onAdd={() => { setDayOpen(false); openCreateForm(selectedDay) }}
        >
          {selectedEvents.map(renderEvent)}
        </DayModal>
      )}

      {showForm && canManageEvents && (
        <div
          className="cal-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm()
          }}
        >
          <section
            className="cal-modal"
            ref={modalRef}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); closeForm() }
              if (event.key === 'Tab') {
                const controls = Array.from(modalRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')).filter((control) => !control.closest('[aria-hidden="true"]'))
                const first = controls[0], last = controls.at(-1)
                if (!first) { event.preventDefault(); return }
                if (event.shiftKey && (event.target === first || event.target === modalRef.current)) { event.preventDefault(); last.focus() }
                else if (!event.shiftKey && (event.target === last || event.target === modalRef.current)) { event.preventDefault(); first.focus() }
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cal-form-title"
          >
            <div className="cal-modal-header">
              <div>
                <h2 id="cal-form-title">
                  {editingEvent ? 'Edit Event' : 'Schedule Event'}
                </h2>
                <p>
                  {editingEvent
                    ? 'Update the event information below.'
                    : 'Add a community event to the shared calendar.'}
                </p>
              </div>
              <button
                type="button"
                className="cal-close-button"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close event form"
              >
                <X size={20} />
              </button>
            </div>

            <form className="cal-form" onSubmit={saveEvent}>
              <label className="cal-field-full">
                Event title
                <input
                  type="text"
                  name="title"
                  value={form.title}
                  onChange={updateForm}
                  maxLength={160}
                  placeholder="e.g. Homeowners General Assembly"
                  disabled={saving}
                  required
                />
              </label>

              <label>
                Event date
                <EventDatePicker value={form.eventDate} onChange={updateForm} disabled={saving} />
              </label>

              <label>
                Location
                <input
                  type="text"
                  name="location"
                  value={form.location}
                  onChange={updateForm}
                  maxLength={160}
                  placeholder="e.g. Clubhouse"
                  disabled={saving}
                />
              </label>

              <TimePicker
                label="Start time"
                name="startTime"
                value={form.startTime}
                onChange={updateForm}
                disabled={saving}
              />

              <TimePicker
                label="End time"
                name="endTime"
                value={form.endTime}
                onChange={updateForm}
                disabled={saving}
              />

              <label className="cal-field-full">
                Description
                <textarea
                  name="description"
                  value={form.description}
                  onChange={updateForm}
                  maxLength={1000}
                  rows={4}
                  placeholder="Add optional event details or instructions"
                  disabled={saving}
                />
              </label>

              {formError && (
                <p className="cal-form-error cal-field-full" role="alert">{formError}</p>
              )}

              <div className="cal-modal-actions cal-field-full">
                <button
                  type="button"
                  className="cal-cancel-button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="cal-primary-button"
                  disabled={saving}
                >
                  {saving
                    ? 'Saving...'
                    : editingEvent
                      ? 'Save Changes'
                      : 'Schedule Event'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <ActionDialog
        open={!!pendingDelete}
        title="Delete Event?"
        message={pendingDelete ? `Delete "${pendingDelete.title}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleteEvent(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
