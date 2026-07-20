import React, { useState } from 'react'
import { RefreshCw } from '../components/Icons'
import './ActivityLogPage.css'

const ACTIVITY_LOG = [
  {
    id: 1,
    user: 'Secretary Maria',
    action: 'Homeowner Updated',
    description: 'Updated contact information for Maria Santos',
    timestamp: '2026-05-01 11:20:15',
    status: 'success',
  },
  {
    id: 2,
    user: 'Secretary John',
    action: 'Payment Processed',
    description: 'Processed payment of ₱7,500 from Juan Dela Cruz (A-2)',
    timestamp: '2026-05-01 10:45:30',
    status: 'success',
  },
  {
    id: 3,
    user: 'Secretary Maria',
    action: 'Account Created',
    description: 'Created new homeowner account for Carlos Reyes (A-4)',
    timestamp: '2026-04-30 09:15:20',
    status: 'success',
  },
  {
    id: 4,
    user: 'Secretary John',
    action: 'Reminder Sent',
    description: 'Sent payment reminder email to 16 overdue accounts',
    timestamp: '2026-04-28 16:45:30',
    status: 'success',
  },
  {
    id: 5,
    user: 'Secretary Maria',
    action: 'Property Verified',
    description: 'Verified property ownership for Block B, Lot 12',
    timestamp: '2026-04-27 14:30:00',
    status: 'success',
  },
  {
    id: 6,
    user: 'Secretary John',
    action: 'Contact Updated',
    description: 'Updated email address for Rosa Morales',
    timestamp: '2026-04-26 10:15:45',
    status: 'success',
  },
  {
    id: 7,
    user: 'Secretary Maria',
    action: 'Document Archived',
    description: 'Archived documents for Block A records',
    timestamp: '2026-04-25 15:22:10',
    status: 'info',
  },
  {
    id: 8,
    user: 'Secretary John',
    action: 'Data Import',
    description: 'Imported 12 new homeowner records',
    timestamp: '2026-04-24 09:30:00',
    status: 'success',
  },
]

export default function ActivityLogPage() {
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const filteredLogs = ACTIVITY_LOG.filter((log) => {
    const matchesFilter = filter === 'all' || log.status === filter
    const matchesSearch =
      log.user.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.description.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const getStatusColor = (status) => {
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

  const getStatusIcon = (status) => {
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

  return (
    <div className="activity-log-page">
      <div className="activity-header">
        <div className="header-content">
          <h1>� Secretary Activity Log</h1>
          <p>Track all secretary activities and contributions</p>
        </div>
      </div>

      <div className="activity-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search activities..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="filter-buttons">
          <button
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Activities
          </button>
          <button
            className={`filter-btn ${filter === 'success' ? 'active' : ''}`}
            onClick={() => setFilter('success')}
          >
            Success
          </button>
          <button
            className={`filter-btn ${filter === 'warning' ? 'active' : ''}`}
            onClick={() => setFilter('warning')}
          >
            Warnings
          </button>
          <button
            className={`filter-btn ${filter === 'info' ? 'active' : ''}`}
            onClick={() => setFilter('info')}
          >
            Info
          </button>
        </div>
      </div>

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
            {filteredLogs.map((log) => (
              <tr key={log.id} className={`status-${log.status}`}>
                <td className="status-cell">
                  <span className={`status-badge ${getStatusColor(log.status)}`}>
                    {getStatusIcon(log.status)}
                  </span>
                </td>
                <td className="user-cell">
                  <strong>{log.user}</strong>
                </td>
                <td className="action-cell">
                  <span className="action-tag">{log.action}</span>
                </td>
                <td className="description-cell">{log.description}</td>
                <td className="timestamp-cell">{log.timestamp}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredLogs.length === 0 && (
          <div className="no-activities">
            <RefreshCw size={48} />
            <p>No activities found</p>
          </div>
        )}
      </div>

      <div className="activity-footer">
        <p>Showing {filteredLogs.length} of {ACTIVITY_LOG.length} activities</p>
      </div>
    </div>
  )
}
