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
import { calendarToday, calendarMonthDays, shiftCalendarMonth, calendarFormValues, isCalendarDate, validateCalendarForm, loadCalendarEvents, saveCalendarEvent, deleteCalendarEvent, preserveCalendarTimePrecision } from '../lib/eventCalendar'
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

function eventSortValue(event) {
  return `${event.event_date}T${event.start_time || '00:00:00'}`
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
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

export default function EventCalendarPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [events, setEvents] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('upcoming')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pageError, setPageError] = useState('')
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
  const canManageEvents = role === 'secretary' && currentUser?.is_active !== false
  useEffect(() => {
    mounted.current = true
    loadEvents()
    const tick = () => setToday(manilaToday())
    const timer = window.setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      mounted.current = false
      request.current += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function resolve() {
      if (suppliedUser) { setCurrentUser(suppliedUser); return }
      try {
        const { data, error } = await supabase.auth.getUser()
        if (error) throw error
        if (!data.user) throw new Error('Sign in again to verify your calendar access.')
        const result = await supabase.from('profiles').select('id, full_name, email, role, is_active').eq('id', data.user.id).single()
        if (result.error) throw result.error
        if (!cancelled && mounted.current) setCurrentUser(result.data)
      } catch (error) {
        if (!cancelled && mounted.current) setPageError(`Calendar account could not be verified: ${error.message}`)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [suppliedUser])

  useEffect(() => {
    if (!showForm) return undefined
    const previous = document.activeElement
    modalRef.current?.querySelector('input')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
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
    setNotice('')
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

  function openCreateForm() {
    if (!canManageEvents || busy.current) return
    const id = globalThis.crypto?.randomUUID?.()
    if (!id) { setPageError('Open the app over HTTPS or localhost before scheduling an event.'); return }
    setCreationId(id)
    setEditingEvent(null)
    setForm({
      ...EMPTY_FORM,
      eventDate: manilaToday(),
    })
    setFormError('')
    setNotice('')
    setShowForm(true)
  }

  function openEditForm(event) {
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
      setEvents((current) => {
        const next = editingEvent ? current.map((item) => item.id === savedEvent.id ? savedEvent : item) : [...current, savedEvent]
        return next.sort((left, right) => eventSortValue(left).localeCompare(eventSortValue(right)))
      })
      if (!editingEvent) setHighlightedEventId(savedEvent.id)
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

  const upcomingCount = events.filter((event) => event.event_date >= today).length
  const thisMonth = today.slice(0, 7)
  const thisMonthCount = events.filter((event) =>
    event.event_date.startsWith(thisMonth),
  ).length

  const filteredEvents = useMemo(() => {
    const term = normalize(search)

    return events
      .filter((event) => {
        const isUpcoming = event.event_date >= today
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'upcoming' && isUpcoming) ||
          (statusFilter === 'past' && !isUpcoming)
        const matchesSearch =
          !term ||
          [event.title, event.location, event.description].some((value) =>
            normalize(value).includes(term),
          )

        return matchesStatus && matchesSearch
      })
      .sort((left, right) => {
        const comparison = eventSortValue(left).localeCompare(
          eventSortValue(right),
        )

        return statusFilter === 'past' ? -comparison : comparison
      })
  }, [events, search, statusFilter, today])

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
              onClick={openCreateForm}
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
          ['Events This Month', calendarStats.thisMonth, 'Month view', 'cal-stat-blue'],
          ['Upcoming Next 7 Days', calendarStats.upcoming, 'Scheduled events', 'cal-stat-green'],
          ["Today's Events", calendarStats.today, 'Events on the current date', 'cal-stat-warning'],
          ['Completed', calendarStats.completed, 'Past events', 'cal-stat-muted'],
        ].map(([label, value, footer, tone]) => (
          <article className="cal-stat-card" key={label}>
            <div className="cal-stat-top"><span>{label}</span><span className={`cal-stat-icon ${tone}`}><Clock size={18} /></span></div>
            <strong>{loading || refreshing ? '—' : loadError ? 'Unavailable' : value.toLocaleString('en-PH')}</strong>
            <small>{footer}</small>
          </article>
        ))}
      </section>

      <div className="cal-toolbar">
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

        <Select ariaLabel="Filter events by status" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'upcoming', label: 'Upcoming Events' }, { value: 'past', label: 'Past Events' }, { value: 'all', label: 'All Events' }]} />
      </div>

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

                {canManageEvents && (
                  <div className="cal-row-actions">
                    <button
                      type="button"
                      className="cal-icon-button"
                      onClick={() => openEditForm(event)}
                      disabled={Boolean(deletingId) || saving || refreshing}
                      aria-label={`Edit ${event.title}`}
                    >
                      <Edit size={17} />
                    </button>
                    <button
                      type="button"
                      className="cal-icon-button cal-delete-button"
                      onClick={() => requestDeleteEvent(event)}
                      disabled={Boolean(deletingId) || saving || refreshing}
                      aria-label={`Delete ${event.title}`}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                )}
              </article>
            )
          })
        )}
      </section>

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