import React, { useState, useEffect } from 'react'
import './AdminDashboard.css'
import { Users, Home, DollarSign, TrendingUp, Lock, HardDrive, BarChart3, AlertCircle, Download, Check, Clock, Zap } from '../components/Icons'

export default function AdminDashboard() {
  const [chartsReady, setChartsReady] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)

  useEffect(() => {
    // Load Chart.js dynamically
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
    script.onload = () => {
      setChartsReady(true)
      initCharts()
    }
    document.head.appendChild(script)
  }, [])

  const initCharts = () => {
    if (typeof Chart === 'undefined') return

    // Bar Chart
    const barCtx = document.getElementById('barChart')
    if (barCtx) {
      new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: ['Block A', 'Block B', 'Block C', 'Block D', 'Block E'],
          datasets: [{
            data: [42, 38, 55, 29, 48],
            backgroundColor: ['rgba(20,100,160,0.65)', 'rgba(26,138,96,0.65)', 'rgba(108,60,160,0.65)', 'rgba(212,146,10,0.80)', 'rgba(192,57,43,0.65)'],
            borderColor: ['rgba(20,100,160,0.90)', 'rgba(26,138,96,0.90)', 'rgba(108,60,160,0.90)', 'rgba(212,146,10,0.95)', 'rgba(192,57,43,0.90)'],
            borderWidth: 1.5,
            borderRadius: 8,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(255,255,255,0.95)',
              titleColor: '#071e30',
              bodyColor: '#2a5470',
              borderColor: 'rgba(200,228,245,0.90)',
              borderWidth: 1,
              padding: 12,
              cornerRadius: 10,
              titleFont: { size: 13, weight: '700', family: "'DM Sans', sans-serif" },
              bodyFont: { size: 12, weight: '500', family: "'DM Sans', sans-serif" },
              callbacks: { label: ctx => '  ' + ctx.parsed.y + ' payments' }
            }
          },
          scales: {
            x: { grid: { display: false }, border: { display: false }, ticks: { color: '#2a5470', font: { size: 12.5, weight: '600' } } },
            y: { grid: { color: 'rgba(255,255,255,0.55)' }, border: { display: false }, ticks: { color: '#2a5470', font: { size: 12, weight: '500' }, stepSize: 10 } }
          }
        }
      })
    }

    // Doughnut Chart
    const donutCtx = document.getElementById('donutChart')
    if (donutCtx) {
      new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['Paid', 'Pending', 'Overdue'],
          datasets: [{
            data: [172, 51, 25],
            backgroundColor: ['rgba(26,138,96,0.82)', 'rgba(212,146,10,0.82)', 'rgba(192,57,43,0.82)'],
            borderColor: 'rgba(255,255,255,0.90)',
            borderWidth: 3,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(255,255,255,0.95)',
              titleColor: '#071e30',
              bodyColor: '#2a5470',
              borderColor: 'rgba(200,228,245,0.90)',
              borderWidth: 1,
              padding: 12,
              cornerRadius: 10,
              callbacks: { label: ctx => '  ' + ctx.label + ': ' + ctx.parsed + ' (' + Math.round(ctx.parsed / 248 * 100) + '%)' }
            }
          }
        }
      })
    }
  }

  const systemStats = [
    { label: 'TOTAL USERS', value: '15', footer: 'Active accounts', icon: Users, color: '#1a8a60' },
    { label: 'PROPERTIES', value: '248', footer: 'Registered lots', icon: Home, color: '#1a8a60' },
    { label: 'COLLECTIONS', value: '₱2.4M', footer: 'Total collected', icon: DollarSign, color: '#1a8a60' },
    { label: 'UPTIME', value: '99.9%', footer: 'System stable', icon: TrendingUp, color: '#2a6080' },
  ]

  const recentActivities = [
    { initials: 'JR', name: 'John Reyes', action: 'Recorded payment', location: 'Block A, Lot 5', time: '2 hours ago' },
    { initials: 'AS', name: 'Angela Santos', action: 'Updated homeowner info', location: 'Block B, Lot 12', time: '5 hours ago' },
    { initials: 'MG', name: 'Maria Garcia', action: 'Generated report', location: 'Monthly Collections', time: '1 day ago' },
    { initials: 'JR', name: 'John Reyes', action: 'Added new property', location: 'Block C, Lot 8', time: '2 days ago' },
    { initials: 'ML', name: 'Mario Lim', action: 'Reset user password', location: 'Secretary account', time: '3 days ago' },
  ]

  const quickTools = [
    { icon: Lock, label: 'Reset User Password', desc: 'Force reset any account' },
    { icon: HardDrive, label: 'Backup System Data', desc: 'Export full data backup' },
    { icon: BarChart3, label: 'System Analytics', desc: 'View usage statistics' },
    { icon: AlertCircle, label: 'View Alerts', desc: 'Check system notifications' },
    { icon: Download, label: 'Export Reports', desc: 'Download monthly reports' },
  ]

  return (
    <div className="dash-admin-dashboard">
      {/* Page Header */}
      <div className="dash-page-header">
        <h1 className="dash-page-title">Admin Dashboard</h1>
        <p className="dash-page-subtitle">Welcome back — here's what's happening in PHILAM Village today.</p>
      </div>

      {/* Stats Grid */}
      <div className="dash-stats-grid">
        {systemStats.map((stat, i) => (
          <div key={i} className="dash-stat-card">
            <div className="dash-stat-top">
              <div className="dash-stat-label">{stat.label}</div>
              <div className="dash-stat-icon-box"><stat.icon size={18} /></div>
            </div>
            <div className="dash-stat-value">{stat.value}</div>
            <div className="dash-stat-footer">
              <TrendingUp size={13} color={stat.color} />
              <span>{stat.footer}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Analytics Overview */}
      <div className="dash-analytics-header">
        <h2 className="dash-section-title">Analytics Overview</h2>
        <a href="#" className="dash-section-link">Last 6 months</a>
      </div>

      <div className="dash-charts-grid">
        {/* Bar Chart */}
        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Payments per Block</h3>
          <div className="dash-date-badge">Jan – Jun 2026</div>
          <canvas id="barChart" height="120"></canvas>
          <div className="dash-bar-legend">
            <div className="dash-legend-item"><div className="dash-legend-box" style={{background:'rgba(20,100,160,0.65)'}}></div>Block A — 42</div>
            <div className="dash-legend-item"><div className="dash-legend-box" style={{background:'rgba(26,138,96,0.65)'}}></div>Block B — 38</div>
            <div className="dash-legend-item"><div className="dash-legend-box" style={{background:'rgba(108,60,160,0.65)'}}></div>Block C — 55</div>
            <div className="dash-legend-item"><div className="dash-legend-box" style={{background:'rgba(212,146,10,0.80)'}}></div>Block D — 29</div>
            <div className="dash-legend-item"><div className="dash-legend-box" style={{background:'rgba(192,57,43,0.65)'}}></div>Block E — 48</div>
          </div>
        </div>

        {/* Doughnut Chart */}
        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Payment Status</h3>
          <div className="dash-donut-container">
            <div className="dash-donut-canvas">
              <canvas id="donutChart"></canvas>
              <div className="dash-donut-center">
                <div className="dash-donut-value">248</div>
                <div className="dash-donut-label">TOTAL</div>
              </div>
            </div>
            <div className="dash-donut-legend">
              <div className="dash-donut-legend-item">
                <div className="dash-donut-dot" style={{background:'rgba(26,138,96,0.82)'}}></div>
                <div className="dash-legend-text">
                  <div className="dash-legend-status">Paid</div>
                  <div className="dash-legend-count">172 <span>69%</span></div>
                </div>
              </div>
              <div className="dash-donut-legend-item">
                <div className="dash-donut-dot" style={{background:'rgba(212,146,10,0.82)'}}></div>
                <div className="dash-legend-text">
                  <div className="dash-legend-status">Pending</div>
                  <div className="dash-legend-count">51 <span>21%</span></div>
                </div>
              </div>
              <div className="dash-donut-legend-item">
                <div className="dash-donut-dot" style={{background:'rgba(192,57,43,0.82)'}}></div>
                <div className="dash-legend-text">
                  <div className="dash-legend-status">Overdue</div>
                  <div className="dash-legend-count">25 <span>10%</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="dash-payment-stats">
            <div className="dash-stat-item"><span>248 properties total</span></div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="dash-quick-actions">
        <button className="dash-actions-header" onClick={() => setActionsOpen(!actionsOpen)}>
          <Zap size={18} className="dash-actions-icon" />
          <span className="dash-actions-label">Quick Actions</span>
          <span className="dash-actions-badge">4 actions</span>
          <svg className={`dash-actions-chevron ${actionsOpen ? 'open' : ''}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
        <div className={`dash-actions-body ${actionsOpen ? 'open' : ''}`}>
          <div className="dash-actions-grid">
            <div className="dash-action-item">
              <div className="dash-action-icon"><Users size={20} /></div>
              <div className="dash-action-content">
                <h4>User Management</h4>
                <p>Manage admin & secretary accounts</p>
              </div>
            </div>
            <div className="dash-action-item">
              <div className="dash-action-icon"><HardDrive size={20} /></div>
              <div className="dash-action-content">
                <h4>View All Data</h4>
                <p>System records and archives</p>
              </div>
            </div>
            <div className="dash-action-item">
              <div className="dash-action-icon"><AlertCircle size={20} /></div>
              <div className="dash-action-content">
                <h4>System Settings</h4>
                <p>Preferences & configurations</p>
              </div>
            </div>
            <div className="dash-action-item">
              <div className="dash-action-icon"><Clock size={20} /></div>
              <div className="dash-action-content">
                <h4>Activity Log</h4>
                <p>Track all user activities</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section - Activities & Tools */}
      <div className="dash-bottom-grid">
        {/* Recent Activities */}
        <div className="dash-activities-panel">
          <div className="dash-panel-head">
            <h3>Latest activity</h3>
            <span className="dash-panel-date">Today, June 7 2026</span>
          </div>
          <div className="dash-activities-list">
            {recentActivities.map((activity, i) => (
              <div key={i} className="dash-activity-row">
                <div className="dash-activity-avatar">{activity.initials}</div>
                <div className="dash-activity-details">
                  <p className="dash-activity-name"><strong>{activity.name}</strong> {activity.action}</p>
                  <p className="dash-activity-location">{activity.location}</p>
                </div>
                <p className="dash-activity-time">{activity.time}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Tools */}
        <div className="dash-tools-panel">
          <div className="dash-panel-head">
            <h3>Admin Tools</h3>
          </div>
          <div className="dash-tools-list">
            {quickTools.map((tool, i) => (
              <div key={i} className="dash-tool-item">
                <div className="dash-tool-icon"><tool.icon size={20} /></div>
                <div className="dash-tool-details">
                  <h4>{tool.label}</h4>
                  <p>{tool.desc}</p>
                </div>
                <svg className="dash-tool-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
