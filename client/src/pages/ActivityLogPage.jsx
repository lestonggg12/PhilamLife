import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  ChevronRight,
  RefreshCw,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { useOrganization } from '../context/OrganizationContext'
import './ActivityLogPage.css'

const MANILA_TIME_ZONE = 'Asia/Manila'
const MANILA_OFFSET = '+08:00'
const PAGE_SIZE = 1000
const TABLE_COLUMN_COUNT = 5
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const timestampFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: MANILA_TIME_ZONE,
})

const selectedDateFormatter = new Intl.DateTimeFormat('en-PH', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

const triggerDateFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function dateKeyFromDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function dateFromKey(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`)
}

function addDays(dateKey, amount) {
  const date = dateFromKey(dateKey)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function monthKeyFromDateKey(dateKey) {
  return dateKey.slice(0, 7)
}

function shiftMonth(monthKey, amount) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + amount, 1))
  return date.toISOString().slice(0, 7)
}

function monthBoundary(monthKey) {
  return new Date(`${monthKey}-01T00:00:00${MANILA_OFFSET}`).toISOString()
}

function getCalendarDays(monthKey) {
  const firstDateKey = `${monthKey}-01`
  const firstDay = dateFromKey(firstDateKey).getUTCDay()
  const gridStart = addDays(firstDateKey, -firstDay)

  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function getLogStatus(action = '') {
  const normalizedAction = action.toLowerCase()

  if (
    normalizedAction.includes('void') ||
    normalizedAction.includes('delete') ||
    normalizedAction.includes('cancel') ||
    normalizedAction.includes('failed')
  ) {
    return 'warning'
  }

  if (
    normalizedAction.includes('update') ||
    normalizedAction.includes('export') ||
    normalizedAction.includes('archive') ||
    normalizedAction.includes('transfer') ||
    normalizedAction.includes('moved')
  ) {
    return 'info'
  }

  return 'success'
}

function getStatusIcon(status) {
  if (status === 'success') return '✓'
  if (status === 'warning') return '⚠'
  if (status === 'info') return 'ℹ'
  return '•'
}

const STATUS_LABELS = {
  success: 'Success',
  warning: 'Warning',
  info: 'Info',
}

export default function ActivityLogPage() {
  const { organization } = useOrganization()
  const initialToday = dateKeyFromDate()
  const [todayKey, setTodayKey] = useState(initialToday)
  const [visibleMonth, setVisibleMonth] = useState(
    monthKeyFromDateKey(initialToday),
  )
  const [selectedDate, setSelectedDate] = useState(initialToday)
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)

  const calendarWrapRef = useRef(null)

  useEffect(() => {
    loadActivityLogs()
  }, [visibleMonth])

  useEffect(() => {
    let midnightTimer

    function scheduleManilaDayChange() {
      const currentToday = dateKeyFromDate()
      const nextMidnight = new Date(
        `${addDays(currentToday, 1)}T00:00:00${MANILA_OFFSET}`,
      )
      const delay = Math.max(nextMidnight.getTime() - Date.now() + 1000, 1000)

      midnightTimer = window.setTimeout(() => {
        const newToday = dateKeyFromDate()
        setTodayKey(newToday)
        setSelectedDate(newToday)
        setVisibleMonth(monthKeyFromDateKey(newToday))
        scheduleManilaDayChange()
      }, delay)
    }

    scheduleManilaDayChange()
    return () => window.clearTimeout(midnightTimer)
  }, [])

  useEffect(() => {
    if (!calendarOpen) return undefined

    function handleClickOutside(event) {
      if (
        calendarWrapRef.current &&
        !calendarWrapRef.current.contains(event.target)
      ) {
        setCalendarOpen(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') setCalendarOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [calendarOpen])

  async function loadActivityLogs(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    setErrorMessage('')

    const monthStart = monthBoundary(visibleMonth)
    const monthEnd = monthBoundary(shiftMonth(visibleMonth, 1))
    const activityData = []
    let activityError = null
    let from = 0

    while (!activityError) {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .gte('created_at', monthStart)
        .lt('created_at', monthEnd)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        activityError = error
        break
      }

      activityData.push(...(data || []))
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    if (activityError) {
      setLogs([])
      setErrorMessage(
        `Activity logs could not be loaded: ${activityError.message}`,
      )
      setLoading(false)
      setRefreshing(false)
      return
    }

    const userIds = [
      ...new Set(activityData.map((log) => log.user_id).filter(Boolean)),
    ]
    let profileMap = new Map()

    if (userIds.length > 0) {
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .in('id', userIds)

      if (!profileError) {
        profileMap = new Map(
          (profiles || []).map((profile) => [profile.id, profile]),
        )
      }
    }

    const preparedLogs = activityData.map((log) => {
      const profile = profileMap.get(log.user_id)
      const role = profile?.role
        ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
        : ''

      return {
        ...log,
        dateKey: dateKeyFromDate(new Date(log.created_at)),
        user: profile?.full_name || profile?.email || 'System User',
        role,
        description:
          log.target || log.description || 'No additional details',
        status: getLogStatus(log.action),
      }
    })

    setLogs(preparedLogs)
    setLoading(false)
    setRefreshing(false)
  }

  const calendarDays = useMemo(
    () => getCalendarDays(visibleMonth),
    [visibleMonth],
  )

  const activityCountByDay = useMemo(() => {
    return logs.reduce((counts, log) => {
      counts[log.dateKey] = (counts[log.dateKey] || 0) + 1
      return counts
    }, {})
  }, [logs])

  const selectedDayLogs = useMemo(
    () => logs.filter((log) => log.dateKey === selectedDate),
    [logs, selectedDate],
  )

  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return selectedDayLogs.filter((log) => {
      const matchesFilter = filter === 'all' || log.status === filter
      const matchesSearch =
        !normalizedSearch ||
        log.user.toLowerCase().includes(normalizedSearch) ||
        log.role.toLowerCase().includes(normalizedSearch) ||
        (log.action || '').toLowerCase().includes(normalizedSearch) ||
        log.description.toLowerCase().includes(normalizedSearch)

      return matchesFilter && matchesSearch
    })
  }, [selectedDayLogs, filter, searchTerm])

  const isTodaySelected = selectedDate === todayKey
  const isArchiveSelected = selectedDate < todayKey

  const calendarTriggerLabel = useMemo(
    () => triggerDateFormatter.format(dateFromKey(selectedDate)),
    [selectedDate],
  )
  const selectedDayHasActivity = Boolean(activityCountByDay[selectedDate])

  function selectDate(dateKey) {
    if (dateKey > todayKey) return
    setSelectedDate(dateKey)
    setVisibleMonth(monthKeyFromDateKey(dateKey))
    setSearchTerm('')
    setFilter('all')
    setCalendarOpen(false)
  }

  function changeMonth(amount) {
    const nextMonth = shiftMonth(visibleMonth, amount)
    const todayMonth = monthKeyFromDateKey(todayKey)
    if (nextMonth > todayMonth) return

    setVisibleMonth(nextMonth)
    if (nextMonth === todayMonth) setSelectedDate(todayKey)
    else setSelectedDate(`${nextMonth}-01`)
    setSearchTerm('')
    setFilter('all')
  }

  function goToToday() {
    selectDate(todayKey)
  }

  function toggleCalendar() {
    setCalendarOpen((current) => !current)
  }

  function formatDescription(description) {
    return description.replace(/\beffective\b/g, 'Effective')
  }

  return (
    <div className="activity-log-page">
      <div className="activity-header">
        <div className="header-content">
          <p className="activity-eyebrow">Secretary workspace</p>
          <h1>Activity Log</h1>
          <p>Daily system activity and calendar-based archive</p>
        </div>
      </div>

      {errorMessage && (
        <div className="activity-error" role="alert">
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      <section className="activity-day-panel">
        <div className="activity-day-heading">
          <div>
            <div className="activity-day-title-row">
              <h2>
                {selectedDateFormatter.format(dateFromKey(selectedDate))}
              </h2>
              <span
                className={`day-type-badge ${
                  isTodaySelected ? 'current' : 'archive'
                }`}
              >
                {isTodaySelected ? 'Current day' : 'Archived day'}
              </span>
            </div>
            <p>
              {selectedDayLogs.length === 0
                ? isTodaySelected
                  ? 'This daily page is ready for new system activities.'
                  : 'No activity was recorded on this day.'
                : `${selectedDayLogs.length} recorded ${
                    selectedDayLogs.length === 1 ? 'activity' : 'activities'
                  } on this day.`}
            </p>
          </div>

          <div className="activity-day-actions">
            <div className="calendar-popover-wrap" ref={calendarWrapRef}>
              <button
                type="button"
                className={`calendar-trigger-btn ${
                  calendarOpen ? 'is-open' : ''
                }`}
                onClick={toggleCalendar}
                aria-haspopup="dialog"
                aria-expanded={calendarOpen}
              >
                <Calendar size={15} />
                {calendarTriggerLabel}
                {selectedDayHasActivity && (
                  <span className="calendar-trigger-dot" aria-hidden="true" />
                )}
              </button>

              {calendarOpen && (
                <div
                  className="calendar-popover"
                  role="dialog"
                  aria-label="Select a date"
                >
                  <div className="calendar-heading">
                    <button
                      type="button"
                      className="calendar-arrow previous"
                      onClick={() => changeMonth(-1)}
                      aria-label="Previous month"
                    >
                      <ChevronRight size={18} />
                    </button>
                    <strong>
                      {monthFormatter.format(dateFromKey(`${visibleMonth}-01`))}
                    </strong>
                    <button
                      type="button"
                      className="calendar-arrow"
                      onClick={() => changeMonth(1)}
                      disabled={visibleMonth >= monthKeyFromDateKey(todayKey)}
                      aria-label="Next month"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>

                  <div className="calendar-weekdays" aria-hidden="true">
                    {WEEKDAYS.map((weekday) => (
                      <span key={weekday}>{weekday}</span>
                    ))}
                  </div>

                  <div className="calendar-grid">
                    {calendarDays.map((dateKey) => {
                      const count = activityCountByDay[dateKey] || 0
                      const isOutsideMonth =
                        monthKeyFromDateKey(dateKey) !== visibleMonth
                      const isFuture = dateKey > todayKey
                      const isToday = dateKey === todayKey
                      const isSelected = dateKey === selectedDate

                      return (
                        <button
                          key={dateKey}
                          type="button"
                          className={[
                            'calendar-day',
                            isOutsideMonth ? 'outside-month' : '',
                            isFuture ? 'future-day' : '',
                            isToday ? 'today' : '',
                            isSelected ? 'selected' : '',
                            count ? 'has-activity' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          disabled={isFuture}
                          onClick={() => selectDate(dateKey)}
                          aria-label={`${selectedDateFormatter.format(
                            dateFromKey(dateKey),
                          )}${
                            count ? `, ${count} activities` : ', no activities'
                          }`}
                          aria-current={isToday ? 'date' : undefined}
                        >
                          <span className="calendar-day-number">
                            {Number(dateKey.slice(-2))}
                          </span>
                          {count > 0 && (
                            <span className="calendar-activity-count">
                              {count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>

                  <div className="calendar-legend-row">
                    <div className="calendar-legend">
                      <span>
                        <i className="today-key" />
                        Today
                      </span>
                      <span>
                        <i className="activity-key" />
                        Has activity
                      </span>
                    </div>
                    <button
                      type="button"
                      className="calendar-today-link"
                      onClick={goToToday}
                      disabled={isTodaySelected}
                    >
                      Jump to today
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              className="refresh-btn"
              onClick={() => loadActivityLogs(true)}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'spin-icon' : ''} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="activity-controls">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search this day..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="search-input"
              aria-label="Search selected day's activity log"
            />
          </div>

          <div className="filter-buttons">
            {[
              ['all', 'All'],
              ['success', 'Success'],
              ['warning', 'Warnings'],
              ['info', 'Info'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`filter-btn ${filter === value ? 'active' : ''}`}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="activity-table-container">
          <table className="activity-table">
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">User</th>
                <th scope="col">Action</th>
                <th scope="col">Description</th>
                <th scope="col">Timestamp</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={TABLE_COLUMN_COUNT} className="table-loading-cell">
                    <RefreshCw size={18} className="spin-icon" />
                    <span>Loading daily activities...</span>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className={`status-${log.status}`}>
                    <td className="status-cell">
                      <span className={`status-badge ${log.status}`} aria-hidden="true">
                        {getStatusIcon(log.status)}
                      </span>
                      <span className="sr-only">
                        {STATUS_LABELS[log.status] || 'Activity'}
                      </span>
                    </td>
                    <td className="user-cell">
                      <strong>{log.user}</strong>
                      {log.role && <small>{log.role}</small>}
                    </td>
                    <td className="action-cell">
                      <span className="action-tag">
                        {log.action || 'Activity'}
                      </span>
                    </td>
                    <td className="description-cell">
                      {formatDescription(log.description)}
                    </td>
                    <td className="timestamp-cell">
                      {log.created_at
                        ? organization.formatDate(log.created_at, { withTime: true })
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!loading && !errorMessage && filteredLogs.length === 0 && (
            <div className="no-activities">
              <Calendar size={46} />
              <strong>
                {isTodaySelected ? 'A fresh day is ready' : 'No activities found'}
              </strong>
              <p>
                {searchTerm || filter !== 'all'
                  ? 'Try changing the search or status filter.'
                  : isArchiveSelected
                    ? 'Nothing was recorded for this archived date.'
                    : 'New system actions will appear here automatically.'}
              </p>
            </div>
          )}
        </div>

        <div className="activity-footer">
          Showing {filteredLogs.length} of {selectedDayLogs.length} activities for this day
        </div>
      </section>
    </div>
  )
}