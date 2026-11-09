import useManilaMonthRollover from '../hooks/useManilaMonthRollover'
import { isVerifiedDashboardSnapshot } from '../lib/dashboardSnapshot'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Skeleton from '../components/skeleton/Skeleton'
import { useNavigate } from 'react-router-dom'
import './AdminDashboard.css'
import AutoFitAmount from '../components/AutoFitAmount'
import {
  Users,
  Home,
  DollarSign,
  TrendingUp,
  Lock,
  HardDrive,
  BarChart3,
  AlertCircle,
  Clock,
  Zap,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'
import { monthlyCollection } from '../lib/dashboardCollections'
import { summarizeAdminAccounts } from '../lib/adminDashboardAccounts'
import { staffActivityCopy } from '../lib/staffActivityText'
import { fetchAll } from '../lib/fetchAll'
import Chart from 'chart.js/auto'
import { useOrganization } from '../context/OrganizationContext'
import { formatDate } from '../config/organization'

const MANILA_TIME_ZONE = 'Asia/Manila'
const ACCOUNT_STATUS_ITEMS = [
  { key: 'balanceDue', label: 'Balance due', color: 'rgba(192,57,43,0.82)' },
  { key: 'advanceCredit', label: 'Advance credit', color: 'rgba(26,138,96,0.82)' },
  { key: 'clear', label: 'Zero balance', color: 'rgba(20,100,160,0.65)' },
]

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 2,
})

const dashboardDateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'full',
  timeZone: MANILA_TIME_ZONE,
})

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function manilaMonthKey(value = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MANILA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

  return `${values.year}-${values.month}`
}

function getLastSixMonths(currentKey = manilaMonthKey()) {
  const [year, month] = currentKey.split('-').map(Number)

  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1))
    return {
      key: `${date.getUTCFullYear()}-${String(
        date.getUTCMonth() + 1,
      ).padStart(2, '0')}`,
      label: monthFormatter.format(date),
    }
  })
}

function getInitials(name) {
  const words = String(name || 'System User')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join('') || 'SU'
  )
}

function formatActivityTime(value, dateFormat) {
  if (!value) return 'Time unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : formatDate(date, { dateFormat, withTime: true })
}

export default function AdminDashboard() {
  const { organization } = useOrganization()
  const navigate = useNavigate()
  const barChartRef = useRef(null)
  const donutChartRef = useRef(null)
  const chartInstancesRef = useRef([])

  const [profiles, setProfiles] = useState([])
  const [properties, setProperties] = useState([])
  const [monthlyRows, setMonthlyRows] = useState([])
  const [overdueSummaries, setOverdueSummaries] = useState([])
  const [activities, setActivities] = useState([])
  const [duesRows, setDuesRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [dashboardPeriod, setDashboardPeriod] = useState(() => manilaMonthKey())
  const [verifiedPeriod, setVerifiedPeriod] = useState(null)
  const requestRef = useRef(0)
  useManilaMonthRollover((nextMonth) => { setDashboardPeriod(nextMonth); void loadDashboard(nextMonth) })

  useEffect(() => {
    void loadDashboard(manilaMonthKey())
    return () => { requestRef.current += 1 }
  }, [])

  async function loadDashboard(period = manilaMonthKey()) {
    const request = ++requestRef.current
    setLoading(true)
    setPageError('')
    const sixMonthsAgoKey = getLastSixMonths(period)[0].key
    try {

    const [
      profileResult,
      propertyResult,
      paymentResult,
      activityResult,
      overdueResult,
      duesResult,
    ] = await Promise.all([
      fetchAll(() => supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active')),
      fetchAll(() => supabase
        .from('properties')
        .select('id, homeowner_id, homeowner_status, current_balance')),
      // The database computes monthly totals in Manila time.
      fetchAll(() => supabase
        .from('monthly_collections')
        .select('month_start, dues_collected, dues_receipts, dues_only_collected, service_collected')
        .gte('month_start', `${sixMonthsAgoKey}-01`)
        .lte('month_start', `${period}-01`)
        .order('month_start'), { tiebreaker: null }),
      supabase
        .from('activity_log')
        .select('id, user_id, action, target, created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(5),
      fetchAll(() => supabase
        .from('property_overdue_summary')
        .select('property_id, balance, overdue_amount, days_overdue, aging_complete')
        .order('property_id'), { tiebreaker: null }),
      // Each homeowner's monthly dues = lot size x price per sqm, computed by the database.
      fetchAll(() => supabase
        .from('property_monthly_dues')
        .select('property_id, monthly_dues')
        .order('property_id'), { tiebreaker: null }),
    ])

    if (request !== requestRef.current) return
    const results = [profileResult, propertyResult, paymentResult, activityResult, overdueResult, duesResult]
    const errors = results.map((result) => result.error).filter(Boolean)
    if (errors.length || !results.every((result) => Array.isArray(result.data))) {
      setPageError('Dashboard data could not be verified for ' + period + '. ' +
        (errors.map((error) => error.message).join(' ') || 'A required record source is incomplete.') +
        ' Refresh the page to retry.')
      setLoading(false)
      return
    }
    // Preserve the last verified snapshot if any query failed; never replace it with zeros.
    setProfiles(profileResult.data)
    setProperties(propertyResult.data)
    setMonthlyRows(paymentResult.data)
    setOverdueSummaries(overdueResult.data)
    setActivities(activityResult.data)
    setDuesRows(duesResult.data)
    setVerifiedPeriod(period)
    setLoading(false)
    } catch (error) {
      if (request !== requestRef.current) return
      setPageError('Dashboard refresh failed for ' + period + ': ' +
        (error?.message || 'Network unavailable') + '. Refresh to retry.')
      setLoading(false)
    }
  }

  const dashboardUnavailable = !isVerifiedDashboardSnapshot({
    period: dashboardPeriod, verifiedPeriod, loading, error: pageError,
  })

  const { balances: accountStatus, owners: activeOwners, overdue: overdueSummary, monthlyDuesTarget } = useMemo(
    () => summarizeAdminAccounts(properties, overdueSummaries, duesRows),
    [properties, overdueSummaries, duesRows],
  )

  const sixMonths = useMemo(() => getLastSixMonths(dashboardPeriod), [dashboardPeriod])

  const collectionsByMonth = useMemo(() => {
    const totals = new Map(sixMonths.map((month) => [month.key, 0]))

    monthlyRows.forEach((row) => {
      const key = String(row.month_start).slice(0, 7)
      if (totals.has(key)) {
        // Association dues only: the monthly target is a dues target. Fees and amenity/service income are not included.
        totals.set(key, totals.get(key) + (Number(row.dues_only_collected) || 0))
      }
    })

    return {
      labels: sixMonths.map((month) => month.label),
      values: sixMonths.map((month) => totals.get(month.key) || 0),
    }
  }, [sixMonths, monthlyRows])

  const servicesThisMonth = useMemo(() => {
    const currentKey = sixMonths[sixMonths.length - 1]?.key
    const row = monthlyRows.find((item) => String(item.month_start).slice(0, 7) === currentKey)
    return Number(row?.service_collected) || 0
  }, [sixMonths, monthlyRows])

  const currentMonthLabel = sixMonths[sixMonths.length - 1]?.label || ''
  const currentMonthCollection = monthlyCollection(monthlyRows.find(
    (row) => String(row.month_start).slice(0, 7) === sixMonths[sixMonths.length - 1]?.key,
  ), 'admin')
  const collectedThisMonth = currentMonthCollection.amount
  const collectedLastMonth = monthlyCollection(monthlyRows.find(
    (row) => String(row.month_start).slice(0, 7) === sixMonths[sixMonths.length - 2]?.key,
  ), 'admin').amount
  const collectedTrendPercent = collectedLastMonth > 0
    ? ((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100
    : null

  const recentActivities = useMemo(() => {
    const profilesById = new Map(
      profiles.map((profile) => [profile.id, profile]),
    )

    return activities.map((activity) => {
      const profile = profilesById.get(activity.user_id)
      const name =
        profile?.full_name || profile?.email || 'Staff name unavailable'

      const copy = staffActivityCopy({ ...activity, user: name })

      return {
        id: activity.id,
        initials: getInitials(name),
        name,
        action: copy.action,
        target: copy.detail,
        time: formatActivityTime(activity.created_at, organization.dateFormat),
      }
    })
  }, [activities, profiles, organization.dateFormat])

  useEffect(() => {
    chartInstancesRef.current.forEach((chart) => chart.destroy())
    chartInstancesRef.current = []
    if (dashboardUnavailable) return undefined

    if (barChartRef.current) {
      const barChart = new Chart(barChartRef.current, {
        data: {
          labels: collectionsByMonth.labels,
          datasets: [
            {
              type: 'bar',
              label: 'Association dues collected',
              data: collectionsByMonth.values,
              backgroundColor: 'rgba(20,100,160,0.65)',
              borderColor: 'rgba(20,100,160,0.90)',
              borderWidth: 1.5,
              borderRadius: 8,
              borderSkipped: false,
              order: 2,
            },
            ...(monthlyDuesTarget == null ? [] : [{
              type: 'line',
              label: 'Current monthly dues target',
              data: collectionsByMonth.labels.map(() => monthlyDuesTarget),
              borderColor: 'rgba(7,30,48,0.55)',
              borderDash: [6, 5],
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: false,
              tension: 0,
              order: 1,
            }]),
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
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
              callbacks: {
                label: (context) =>
                  `  ${context.dataset.label}: ${peso.format(context.parsed.y)}`,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: {
                color: '#2a5470',
                font: { size: 12.5, weight: '600' },
              },
            },
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.55)' },
              border: { display: false },
              ticks: {
                color: '#2a5470',
                font: { size: 11.5, weight: '500' },
                callback: (value) => `₱${(value / 1000).toLocaleString('en-PH')}k`,
              },
            },
          },
        },
      })

      chartInstancesRef.current.push(barChart)
    }

    if (donutChartRef.current) {
      const donutChart = new Chart(donutChartRef.current, {
        type: 'doughnut',
        data: {
          labels: ACCOUNT_STATUS_ITEMS.map((item) => item.label),
          datasets: [
            {
              data: ACCOUNT_STATUS_ITEMS.map((item) => accountStatus[item.key]),
              backgroundColor: ACCOUNT_STATUS_ITEMS.map((item) => item.color),
              borderColor: 'rgba(255,255,255,0.90)',
              borderWidth: 3,
              hoverOffset: 8,
            },
          ],
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
              callbacks: {
                label: (context) => {
                  const percent = accountStatus.total
                    ? Math.round(
                        (context.parsed / accountStatus.total) * 100,
                      )
                    : 0
                  return `  ${context.label}: ${context.parsed} (${percent}%)`
                },
              },
            },
          },
        },
      })

      chartInstancesRef.current.push(donutChart)
    }

    return () => {
      chartInstancesRef.current.forEach((chart) => chart.destroy())
      chartInstancesRef.current = []
    }
  }, [
    accountStatus,
    dashboardUnavailable,
    collectionsByMonth,
    monthlyDuesTarget,
  ])

  const activeUserProfiles = profiles.filter((profile) => profile.is_active !== false)
  const activeUserCount = activeUserProfiles.length
  const activeRoleLabels = [...new Set(
    activeUserProfiles.map((profile) => {
      const role = String(profile.role || '').trim().toLowerCase()
      return role ? role.charAt(0).toUpperCase() + role.slice(1) : null
    }).filter(Boolean),
  )]

  const systemStats = [
    {
      label: 'ACTIVE PROPERTY ACCOUNTS',
      value: dashboardUnavailable ? '—' : accountStatus.total.toLocaleString('en-PH'),
      footer: dashboardUnavailable ? 'Data not verified' : `${activeOwners.toLocaleString('en-PH')} registered owners`,
      trend: null,
      icon: Users,
      tone: 'blue',
    },
    {
      label: `HOMEOWNER COLLECTIONS ${currentMonthLabel.split(' ')[0]?.toUpperCase() || ''}`,
      value: dashboardUnavailable ? '—' : peso.format(collectedThisMonth),
      fitAmount: true,
      footer: dashboardUnavailable ? 'Data not verified' : `${currentMonthCollection.receipts} homeowner receipt${currentMonthCollection.receipts === 1 ? '' : 's'}${servicesThisMonth > 0 ? ` · Services separately: ${peso.format(servicesThisMonth)}` : ''}`,
      trend: dashboardUnavailable || collectedTrendPercent === null
        ? null
        : `${collectedTrendPercent >= 0 ? '+' : ''}${collectedTrendPercent.toFixed(1)}% vs full ${sixMonths.at(-2)?.label || 'prior month'}`,
      icon: DollarSign,
      tone: 'green',
    },
    {
      label: 'OVERDUE ACCOUNTS',
      value: dashboardUnavailable || overdueSummary.reviewCount ? '—' : overdueSummary.overdueCount.toLocaleString('en-PH'),
      footer: dashboardUnavailable ? 'Data not verified'
        : overdueSummary.reviewCount ? `${overdueSummary.reviewCount} account(s) need aging review`
          : `${peso.format(overdueSummary.overdueBalance)} past due`,
      trend: null,
      icon: AlertCircle,
      tone: 'red',
    },
    {
      label: 'ACTIVE USERS',
      value: dashboardUnavailable ? '—' : activeUserCount.toLocaleString('en-PH'),
      footer: dashboardUnavailable ? '' : (activeRoleLabels.join(', ') || 'No active accounts'),
      trend: null,
      icon: Zap,
      tone: 'navy',
    },
  ]

  const quickActions = [
    {
      icon: HardDrive,
      label: 'View Ledger',
      description: 'Property balances and account statements',
      path: '/ledger',
    },
    {
      icon: AlertCircle,
      label: 'System Settings',
      description: 'Preferences and configurations',
      path: '/system-settings',
    },
    {
      icon: Clock,
      label: 'Activity Log',
      description: 'Track all user activities',
      path: '/activity-log',
    },
  ]

  const adminTools = [
    {
      icon: BarChart3,
      label: 'Financial Reports',
      description: 'Review live collection reports',
      path: '/reports',
    },
    {
      icon: Home,
      label: 'Homeowner Ledger',
      description: 'Review properties and balances',
      path: '/ledger',
    },
    {
      icon: Clock,
      label: 'Activity Log',
      description: 'Review recorded system activity',
      path: '/activity-log',
    },
    {
      icon: Lock,
      label: 'System Settings',
      description: 'Manage system configuration',
      path: '/system-settings',
    },
  ]

  const monthRangeLabel = `${sixMonths[0]?.label || ''} – ${
    sixMonths[sixMonths.length - 1]?.label || ''
  }`

  return (
    <div className="dash-admin-dashboard">
      <div className="dash-page-header">
        <div className="dash-page-header-copy">
          <p className="dash-eyebrow">Admin workspace</p>
          <h1 className="dash-page-title">Admin Dashboard</h1>
          <p className="dash-page-subtitle">
            Manage users, homeowner records, finances, and system operations.
          </p>
        </div>
      </div>

      {pageError && <p className="dash-page-error">{pageError}</p>}

      <div className="dash-stats-grid">
        {systemStats.map((stat) => (
          <div key={stat.label} className="dash-stat-card">
            <div className="dash-stat-top">
              <div className="dash-stat-label">{stat.label}</div>
              <div className={`dash-stat-icon-box tone-${stat.tone}`}>
                <stat.icon size={18} />
              </div>
            </div>
            {stat.fitAmount
              ? <AutoFitAmount className="dash-stat-value" value={stat.value} />
              : <div className="dash-stat-value">{stat.value}</div>}
            <div className="dash-stat-footer">
              <span>{stat.footer}</span>
            </div>
            {stat.trend && (
              <div className={`dash-stat-trend ${stat.trend.startsWith('-') ? 'down' : 'up'}`}>
                <TrendingUp size={13} />
                <span>{stat.trend}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="dash-analytics-header">
        <h2 className="dash-section-title">Analytics Overview</h2>
        <span className="dash-section-link">Last 6 months</span>
      </div>

      <div className="dash-charts-grid">
        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Association Dues Collected</h3>
          <p className="dash-chart-subtitle">{dashboardUnavailable ? 'Reporting data unavailable' : monthRangeLabel}</p>
          {!dashboardUnavailable && monthlyDuesTarget > 0 && (
            <div className="dash-date-badge dash-target-badge">
              Current target {peso.format(monthlyDuesTarget)} / mo
            </div>
          )}
          {!dashboardUnavailable && monthlyDuesTarget == null && (
            <p className="dash-chart-subtitle">Monthly target unavailable. Check lot dues settings.</p>
          )}
          <canvas ref={barChartRef} height="130" style={{ visibility: dashboardUnavailable ? 'hidden' : 'visible' }} />
        </div>

        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Account Balance Status</h3>
          <p className="dash-chart-subtitle">
            {dashboardUnavailable ? <Skeleton variant="rect" width="120px" height="1em" /> : `${accountStatus.total.toLocaleString('en-PH')} total properties`}
          </p>
          <div className="dash-donut-container">
            <div className="dash-donut-canvas">
              <canvas ref={donutChartRef} style={{ visibility: dashboardUnavailable ? 'hidden' : 'visible' }} />
              <div className="dash-donut-center">
                <div className="dash-donut-value">
                  {dashboardUnavailable ? '—' : accountStatus.total}
                </div>
                <div className="dash-donut-label">PROPERTIES</div>
              </div>
            </div>
            <div className="dash-donut-legend">
              {ACCOUNT_STATUS_ITEMS.map((item) => {
                const value = accountStatus[item.key]
                const percent = accountStatus.total
                  ? Math.round(
                      (value / accountStatus.total) * 100,
                    )
                  : 0

                return (
                  <div className="dash-donut-legend-item" key={item.label}>
                    <div
                      className="dash-donut-dot"
                      style={{ background: item.color }}
                    />
                    <div className="dash-legend-text">
                      <div className="dash-legend-status">{item.label}</div>
                      <div className="dash-legend-count">
                        {dashboardUnavailable ? '—' : value}{' '}
                        <span>{dashboardUnavailable ? '—' : `${percent}%`}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="dash-quick-actions">
        <button
          type="button"
          className="dash-actions-header"
          onClick={() => setActionsOpen((current) => !current)}
          aria-expanded={actionsOpen}
        >
          <Zap size={18} className="dash-actions-icon" />
          <span className="dash-actions-label">Quick Actions</span>
          <span className="dash-actions-badge">
            {quickActions.length} actions
          </span>
          <svg
            className={`dash-actions-chevron ${
              actionsOpen ? 'open' : ''
            }`}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
        <div className={`dash-actions-body ${actionsOpen ? 'open' : ''}`}>
          <div className="dash-actions-grid">
            {quickActions.map((action) => (
              <button
                type="button"
                className="dash-action-item"
                key={action.path}
                onClick={() => navigate(action.path)}
              >
                <div className="dash-action-icon">
                  <action.icon size={20} />
                </div>
                <div className="dash-action-content">
                  <h4>{action.label}</h4>
                  <p>{action.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-bottom-grid">
        <div className="dash-activities-panel">
          <div className="dash-panel-head">
            <h3>Recent Activity</h3>
            <span className="dash-panel-date">
              {dashboardDateFormatter.format(new Date())}
            </span>
          </div>
          <div className="dash-activities-list">
            {loading ? (
              <div className="dash-empty-state" aria-busy="true"><Skeleton variant="rect" width="100%" height="52px" /><Skeleton variant="rect" width="100%" height="52px" /><Skeleton variant="rect" width="100%" height="52px" /><span className="skeleton-region-status" role="status">Loading</span></div>
            ) : dashboardUnavailable ? (
              <p className="dash-empty-state">Latest activity unavailable. Refresh to verify this reporting period.</p>
            ) : recentActivities.length === 0 ? (
              <p className="dash-empty-state">
                No recent entries in the live activity log.
              </p>
            ) : (
              recentActivities.map((activity) => (
                <div key={activity.id} className="dash-activity-row">
                  <div className="dash-activity-avatar">
                    {activity.initials}
                  </div>
                  <div className="dash-activity-details">
                    <p className="dash-activity-name">
                      <strong>{activity.name}</strong> {activity.action}
                    </p>
                    <p className="dash-activity-location">
                      {activity.target}
                    </p>
                  </div>
                  <p className="dash-activity-time">{activity.time}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dash-tools-panel">
          <div className="dash-panel-head">
            <h3>Admin Tools</h3>
          </div>
          <div className="dash-tools-list">
            {adminTools.map((tool) => (
              <button
                type="button"
                className="dash-tool-item"
                key={tool.path}
                onClick={() => navigate(tool.path)}
              >
                <div className="dash-tool-icon">
                  <tool.icon size={20} />
                </div>
                <div className="dash-tool-details">
                  <h4>{tool.label}</h4>
                  <p>{tool.description}</p>
                </div>
                <svg
                  className="dash-tool-arrow"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
