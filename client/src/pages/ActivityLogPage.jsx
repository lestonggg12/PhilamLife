import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import './ActivityLogPage.css'

const timestampFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'Asia/Manila',
})

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
    normalizedAction.includes('archive')
  ) {
    return 'info'
  }

  return 'success'
}

function getStatusColor(status) {
  switch (status) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'info':
      return 'info'
    default:
      return 'default'
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'success':
      return '✓'
    case 'warning':
      return '⚠'
    case 'info':
      return 'ℹ'
    default:
      return '•'
  }
}

export default function ActivityLogPage() {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    loadActivityLogs()
  }, [])

  async function loadActivityLogs(isRefresh = false) {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    setErrorMessage('')

    const { data: activityData, error: activityError } =
      await supabase
        .from('activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)

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
      ...new Set(
        (activityData || [])
          .map((log) => log.user_id)
          .filter(Boolean),
      ),
    ]

    let profileMap = new Map()

    if (userIds.length > 0) {
      const { data: profiles, error: profileError } =
        await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('id', userIds)

      if (!profileError) {
        profileMap = new Map(
          (profiles || []).map((profile) => [
            profile.id,
            profile,
          ]),
        )
      }
    }

    const preparedLogs = (activityData || []).map((log) => {
      const profile = profileMap.get(log.user_id)
      const role = profile?.role
        ? profile.role.charAt(0).toUpperCase() +
          profile.role.slice(1)
        : ''

      return {
        ...log,
        user:
          profile?.full_name ||
          profile?.email ||
          'System User',
        role,
        description:
          log.target ||
          log.description ||
          'No additional details',
        status: getLogStatus(log.action),
      }
    })

    setLogs(preparedLogs)
    setLoading(false)
    setRefreshing(false)
  }

  const filteredLogs = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()

    return logs.filter((log) => {
      const matchesFilter =
        filter === 'all' || log.status === filter

      const matchesSearch =
        !normalizedSearch ||
        log.user.toLowerCase().includes(normalizedSearch) ||
        log.role.toLowerCase().includes(normalizedSearch) ||
        (log.action || '')
          .toLowerCase()
          .includes(normalizedSearch) ||
        log.description
          .toLowerCase()
          .includes(normalizedSearch)

      return matchesFilter && matchesSearch
    })
  }, [logs, filter, searchTerm])

  return (
    <div className="activity-log-page">
      <div className="activity-header">
        <div className="header-content">
          <h1>Activity Log</h1>
          <p>
            Track recorded activities performed by authorized
            system users
          </p>
        </div>
      </div>

      <div className="activity-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search activities..."
            value={searchTerm}
            onChange={(event) =>
              setSearchTerm(event.target.value)
            }
            className="search-input"
          />
        </div>

        <div className="filter-buttons">
          <button
            type="button"
            className={`filter-btn ${
              filter === 'all' ? 'active' : ''
            }`}
            onClick={() => setFilter('all')}
          >
            All Activities
          </button>

          <button
            type="button"
            className={`filter-btn ${
              filter === 'success' ? 'active' : ''
            }`}
            onClick={() => setFilter('success')}
          >
            Success
          </button>

          <button
            type="button"
            className={`filter-btn ${
              filter === 'warning' ? 'active' : ''
            }`}
            onClick={() => setFilter('warning')}
          >
            Warnings
          </button>

          <button
            type="button"
            className={`filter-btn ${
              filter === 'info' ? 'active' : ''
            }`}
            onClick={() => setFilter('info')}
          >
            Info
          </button>

          <button
            type="button"
            className="filter-btn"
            onClick={() => loadActivityLogs(true)}
            disabled={refreshing}
          >
            <RefreshCw size={14} />

            {refreshing ? ' Refreshing...' : ' Refresh'}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="no-activities">
          <p>{errorMessage}</p>
        </div>
      )}

      <div className="activity-table-container">
        <table className="activity-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>User</th>
              <th>Action</th>
              <th>Description</th>
              <th>Timestamp</th>
            </tr>
          </thead>

          <tbody>
            {!loading &&
              filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className={`status-${log.status}`}
                >
                  <td className="status-cell">
                    <span
                      className={`status-badge ${getStatusColor(
                        log.status,
                      )}`}
                    >
                      {getStatusIcon(log.status)}
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
                    {log.description}
                  </td>

                  <td className="timestamp-cell">
                    {log.created_at
                      ? timestampFormatter.format(
                          new Date(log.created_at),
                        )
                      : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {loading && (
          <div className="no-activities">
            <RefreshCw size={48} />
            <p>Loading activities...</p>
          </div>
        )}

        {!loading &&
          !errorMessage &&
          filteredLogs.length === 0 && (
            <div className="no-activities">
              <RefreshCw size={48} />
              <p>No activities found</p>
            </div>
          )}
      </div>

      <div className="activity-footer">
        <p>
          Showing {filteredLogs.length} of {logs.length}{' '}
          activities
        </p>
      </div>
    </div>
  )
}