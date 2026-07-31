import React, { useEffect, useMemo, useState } from 'react'
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
  timeZone: 'Asia/Manila',
})

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  timeZone: 'Asia/Manila',
})

function manilaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const part = (type) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function dateInManila(date) {
  return new Date(`${date}T00:00:00+08:00`)
}

function formatTime(time) {
  if (!time) return ''

  const [hourValue, minute = '00'] = time.split(':')
  const hour = Number(hourValue)

  if (Number.isNaN(hour)) return time

  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${minute} ${period}`
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
    period: hour >= 12 ? 'PM' : 'AM',
  }
}

function timeValue({ hour, minute, period }) {
  const hour12 = Number(hour || '12')
  const hour24 = (hour12 % 12) + (period === 'PM' ? 12 : 0)
  return `${String(hour24).padStart(2, '0')}:${minute || '00'}`
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

    onChange({ target: { name, value: timeValue(nextParts) } })
  }

  function clearTime() {
    onChange({ target: { name, value: '' } })
  }

  return (
    <div className="cal-time-field">
      <div className="cal-time-label">
        <span>{label}</span>
        <span className="cal-optional-label">Optional</span>
      </div>

      <div className="cal-time-control">
        <Clock size={17} aria-hidden="true" />

        <select
          value={parts.hour}
          onChange={(event) => updatePart('hour', event.target.value)}
          disabled={disabled}
          aria-label={`${label} hour`}
        >
          <option value="" disabled>
            HH
          </option>
          {TIME_HOURS.map((hour) => (
            <option key={hour} value={hour}>
              {hour}
            </option>
          ))}
        </select>

        <span className="cal-time-separator" aria-hidden="true">
          :
        </span>

        <select
          value={parts.minute}
          onChange={(event) => updatePart('minute', event.target.value)}
          disabled={disabled}
          aria-label={`${label} minute`}
        >
          <option value="" disabled>
            MM
          </option>
          {TIME_MINUTES.map((minute) => (
            <option key={minute} value={minute}>
              {minute}
            </option>
          ))}
        </select>

        <select
          className="cal-period-select"
          value={parts.period}
          onChange={(event) => updatePart('period', event.target.value)}
          disabled={disabled}
          aria-label={`${label} period`}
        >
          <option value="" disabled>
            AM/PM
          </option>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>

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
  const [notice, setNotice] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const role = currentUser?.role?.trim().toLowerCase()
  const canManageEvents = role === 'secretary'
  const actorName =
    currentUser?.full_name ||
    currentUser?.name ||
    currentUser?.email ||
    'Secretary'

  useEffect(() => {
    loadEvents()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !authUser) return

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadEvents(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setPageError('')
    setNotice('')

    const { data, error } = await supabase
      .from('events')
      .select(
        'id, title, description, event_date, start_time, end_time, location, created_by, created_by_name, created_at, updated_at',
      )
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true })

    if (error) {
      setEvents([])
      setPageError(`Events could not be loaded: ${error.message}`)
    } else {
      setEvents(data || [])
    }

    setLoading(false)
    setRefreshing(false)
  }

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFormError('')
  }

  function openCreateForm() {
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
    setEditingEvent(event)
    setForm({
      title: event.title || '',
      eventDate: event.event_date || '',
      startTime: event.start_time?.slice(0, 5) || '',
      endTime: event.end_time?.slice(0, 5) || '',
      location: event.location || '',
      description: event.description || '',
    })
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

  function validateForm() {
    const title = form.title.trim().replace(/\s+/g, ' ')
    const location = form.location.trim().replace(/\s+/g, ' ')
    const description = form.description.trim().replace(/\s+/g, ' ')

    if (!title) return { error: 'Enter an event title.' }
    if (!form.eventDate) return { error: 'Choose an event date.' }
    if (title.length > 160) {
      return { error: 'Event title must be 160 characters or fewer.' }
    }
    if (location.length > 160) {
      return { error: 'Location must be 160 characters or fewer.' }
    }
    if (description.length > 1000) {
      return { error: 'Description must be 1,000 characters or fewer.' }
    }
    if (form.endTime && !form.startTime) {
      return { error: 'Add a start time before adding an end time.' }
    }
    if (form.startTime && form.endTime && form.endTime <= form.startTime) {
      return { error: 'End time must be later than the start time.' }
    }

    return {
      payload: {
        title,
        description: description || null,
        event_date: form.eventDate,
        start_time: form.startTime || null,
        end_time: form.endTime || null,
        location: location || null,
        updated_at: new Date().toISOString(),
      },
    }
  }

  async function saveEvent(event) {
    event.preventDefault()

    if (!canManageEvents || !currentUser?.id) {
      setFormError('Only a verified Secretary can manage events.')
      return
    }

    const validation = validateForm()

    if (validation.error) {
      setFormError(validation.error)
      return
    }

    setSaving(true)
    setFormError('')

    const fields =
      'id, title, description, event_date, start_time, end_time, location, created_by, created_by_name, created_at, updated_at'
    let result

    if (editingEvent) {
      result = await supabase
        .from('events')
        .update(validation.payload)
        .eq('id', editingEvent.id)
        .select(fields)
        .single()
    } else {
      result = await supabase
        .from('events')
        .insert({
          ...validation.payload,
          created_by: currentUser.id,
          created_by_name: actorName,
        })
        .select(fields)
        .single()
    }

    if (result.error) {
      setFormError(result.error.message)
      setSaving(false)
      return
    }

    const savedEvent = result.data
    const action = editingEvent ? 'Event Updated' : 'Event Scheduled'
    const { error: activityError } = await supabase
      .from('activity_log')
      .insert({
        user_id: currentUser.id,
        action,
        target: `${savedEvent.title} — ${savedEvent.event_date} (by ${actorName})`,
      })

    if (activityError) {
      console.warn(
        'Event saved, but activity logging failed:',
        activityError.message,
      )
    }

    setEvents((current) => {
      const next = editingEvent
        ? current.map((item) => (item.id === savedEvent.id ? savedEvent : item))
        : [...current, savedEvent]

      return next.sort((left, right) =>
        eventSortValue(left).localeCompare(eventSortValue(right)),
      )
    })

    setShowForm(false)
    setEditingEvent(null)
    setForm(EMPTY_FORM)
    setSaving(false)
    setNotice(
      editingEvent
        ? `“${savedEvent.title}” was updated.`
        : `“${savedEvent.title}” was scheduled.`,
    )
  }

  async function deleteEvent(event) {
    if (!canManageEvents || !currentUser?.id) return

    const confirmed = window.confirm(
      `Delete “${event.title}”? This cannot be undone.`,
    )

    if (!confirmed) return

    setDeletingId(event.id)
    setPageError('')
    setNotice('')

    const { error } = await supabase.from('events').delete().eq('id', event.id)

    if (error) {
      setPageError(`Event could not be deleted: ${error.message}`)
      setDeletingId(null)
      return
    }

    const { error: activityError } = await supabase
      .from('activity_log')
      .insert({
        user_id: currentUser.id,
        action: 'Event Deleted',
        target: `${event.title} — ${event.event_date} (by ${actorName})`,
      })

    if (activityError) {
      console.warn(
        'Event deleted, but activity logging failed:',
        activityError.message,
      )
    }

    setEvents((current) => current.filter((item) => item.id !== event.id))
    setDeletingId(null)
    setNotice(`“${event.title}” was deleted.`)
  }

  const today = manilaToday()
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

  return (
    <div className="cal-page">
      <header className="cal-header">
        <div>
          <h1>Event Calendar</h1>
          <p>Schedule and manage community meetings and events.</p>
        </div>

        <div className="cal-header-actions">
          <button
            type="button"
            className="cal-refresh-button"
            onClick={() => loadEvents(true)}
            disabled={refreshing}
          >
            <RefreshCw size={17} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {canManageEvents && (
            <button
              type="button"
              className="cal-primary-button"
              onClick={openCreateForm}
            >
              <Plus size={18} />
              Schedule Event
            </button>
          )}
        </div>
      </header>

      <section className="cal-summary" aria-label="Event summaries">
        <article>
          <span>Total events</span>
          <strong>{loading ? '—' : events.length}</strong>
        </article>
        <article>
          <span>Upcoming</span>
          <strong>{loading ? '—' : upcomingCount}</strong>
        </article>
        <article>
          <span>This month</span>
          <strong>{loading ? '—' : thisMonthCount}</strong>
        </article>
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

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="cal-filter"
          aria-label="Filter events by status"
        >
          <option value="upcoming">Upcoming Events</option>
          <option value="past">Past Events</option>
          <option value="all">All Events</option>
        </select>
      </div>

      <div className="cal-result-count">
        Showing {filteredEvents.length} of {events.length} events
      </div>

      {pageError && <p className="cal-message cal-error">{pageError}</p>}
      {notice && <p className="cal-message cal-success">{notice}</p>}

      <section className="cal-list glass-card" aria-live="polite">
        {loading ? (
          <p className="cal-empty">Loading events...</p>
        ) : filteredEvents.length === 0 ? (
          <p className="cal-empty">
            {events.length === 0
              ? 'No events have been scheduled yet.'
              : 'No events match your search or filter.'}
          </p>
        ) : (
          filteredEvents.map((event) => {
            const eventDate = dateInManila(event.event_date)
            const isPast = event.event_date < today

            return (
              <article
                key={event.id}
                className={`cal-row ${isPast ? 'cal-row-past' : ''}`}
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

                <div className="cal-row-actions">
                  <button
                    type="button"
                    className="cal-icon-button"
                    onClick={() => openEditForm(event)}
                    disabled={!canManageEvents || deletingId === event.id}
                    aria-label={`Edit ${event.title}`}
                  >
                    <Edit size={17} />
                  </button>
                  <button
                    type="button"
                    className="cal-icon-button cal-delete-button"
                    onClick={() => deleteEvent(event)}
                    disabled={!canManageEvents || deletingId === event.id}
                    aria-label={`Delete ${event.title}`}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            )
          })
        )}
      </section>

      {showForm && (
        <div
          className="cal-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm()
          }}
        >
          <section
            className="cal-modal"
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
                  autoFocus
                  required
                />
              </label>

              <label>
                Event date
                <input
                  type="date"
                  name="eventDate"
                  value={form.eventDate}
                  onChange={updateForm}
                  disabled={saving}
                  required
                />
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
                <p className="cal-form-error cal-field-full">{formError}</p>
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
    </div>
  )
}