import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './SecretaryDashboard.css'
import { FileText, Users, AlertCircle, CheckCircle, TrendingUp } from '../components/Icons'

export default function SecretaryDashboard() {
  const [actionsOpen, setActionsOpen] = useState(true)
  const navigate = useNavigate()

  return (
    <div className="sec-secretary-dashboard">
      <div className="sec-page-header">
        <h1 className="sec-page-title">Secretary Dashboard</h1>
        <p className="sec-page-subtitle">Manage communications, records, and announcements.</p>
      </div>

      {/* Stats Grid */}
      <div className="sec-stats-grid">
        <div className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Total Documents</span>
            <div className="sec-stat-icon-box">
              <FileText size={18} />
            </div>
          </div>
          <h3 className="sec-stat-value">115</h3>
          <div className="sec-stat-footer">
            <TrendingUp size={12} />
            <span>+12 this month</span>
          </div>
        </div>

        <div className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Communications</span>
            <div className="sec-stat-icon-box" style={{ background: 'rgba(212, 146, 10, 0.12)', color: '#d49206' }}>
              <Users size={18} />
            </div>
          </div>
          <h3 className="sec-stat-value">206</h3>
          <div className="sec-stat-footer">
            <CheckCircle size={12} />
            <span>All delivered</span>
          </div>
        </div>

        <div className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Pending Tasks</span>
            <div className="sec-stat-icon-box" style={{ background: 'rgba(192, 57, 43, 0.12)', color: '#c0392b' }}>
              <AlertCircle size={18} />
            </div>
          </div>
          <h3 className="sec-stat-value">8</h3>
          <div className="sec-stat-footer">
            <TrendingUp size={12} />
            <span>Due this week</span>
          </div>
        </div>

        <div className="sec-stat-card">
          <div className="sec-stat-top">
            <span className="sec-stat-label">Response Rate</span>
            <div className="sec-stat-icon-box" style={{ background: 'rgba(108, 60, 160, 0.12)', color: '#6c3ca0' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <h3 className="sec-stat-value">87%</h3>
          <div className="sec-stat-footer">
            <CheckCircle size={12} />
            <span>Homeowner engagement</span>
          </div>
        </div>
      </div>

      {/* Recent Activities */}
      <div className="sec-bottom-grid">
        <div className="sec-activities-panel">
          <h3 className="sec-section-title">Recent Activities</h3>

          <div className="sec-activity-row">
            <div className="sec-activity-avatar" style={{ background: '#1464a0' }}>📨</div>
            <div className="sec-activity-content">
              <p className="sec-activity-title">Board Meeting Minutes Posted</p>
              <p className="sec-activity-time">2 hours ago</p>
            </div>
          </div>

          <div className="sec-activity-row">
            <div className="sec-activity-avatar" style={{ background: '#1a8a60' }}>✓</div>
            <div className="sec-activity-content">
              <p className="sec-activity-title">Announcement Delivered to All Units</p>
              <p className="sec-activity-time">4 hours ago</p>
            </div>
          </div>

          <div className="sec-activity-row">
            <div className="sec-activity-avatar" style={{ background: '#d49206' }}>⚠</div>
            <div className="sec-activity-content">
              <p className="sec-activity-title">5 Pending Survey Responses</p>
              <p className="sec-activity-time">1 day ago</p>
            </div>
          </div>
        </div>

        <div className="sec-tools-panel">
          <h3 className="sec-section-title">Useful Tools</h3>

          <button type="button" className="sec-tool-item" onClick={() => navigate('/documents')}>
            <span className="sec-tool-icon">📋</span>
            <div>
              <p className="sec-tool-title">Document Library</p>
              <p className="sec-tool-desc">Access all files</p>
            </div>
          </button>

          <button type="button" className="sec-tool-item" onClick={() => navigate('/calendar')}>
            <span className="sec-tool-icon">📅</span>
            <div>
              <p className="sec-tool-title">Event Calendar</p>
              <p className="sec-tool-desc">Schedule meetings</p>
            </div>
          </button>

          <button type="button" className="sec-tool-item" onClick={() => navigate('/contacts')}>
            <span className="sec-tool-icon">👥</span>
            <div>
              <p className="sec-tool-title">Contact Manager</p>
              <p className="sec-tool-desc">Homeowner list</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}