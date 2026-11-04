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
import { fetchAll } from '../lib/fetchAll'
import Chart from 'chart.js/auto'
import { useOrganization } from '../context/OrganizationContext'
import { formatDate } from '../config/organization'

const MANILA_TIME_ZONE = 'Asia/Manila'

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
  const [paidPropertyIds, setPaidPropertyIds] = useState(new Set())
  const [overdueSummaries, setOverdueSummaries] = useState([])
  const [activities, setActivities] = useState([])
  const [duesByProperty, setDuesByProperty] = useState(new Map())
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
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
      serviceResult,
      activityResult,
      settingsResult,
      overdueResult,
      duesResult,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active'),
      fetchAll(() => supabase
        .from('properties')
        .select('id, block, lot_number, homeowner_name, homeowner_status, current_balance')),
      // Monthly totals (last 6 months) and which homeowners have paid, both
      // computed by the database - a few dozen rows instead of every payment.
      fetchAll(() => supabase
        .from('monthly_collections')
        .select('month_start, dues_collected, dues_receipts, dues_only_collected, service_collected')
        .gte('month_start', `${sixMonthsAgoKey}-01`)
        .order('month_start'), { tiebreaker: null }),
      fetchAll(() => supabase
        .from('property_payment_summary')
        .select('property_id')
        .order('property_id'), { tiebreaker: null }),
      supabase
        .from('activity_log')
        .select('id, user_id, action, target, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('system_settings')
        .select('due_day, grace_period_days, late_penalty')
        .eq('id', 1)
        .maybeSingle(),
      fetchAll(() => supabase
        .from('property_overdue_summary')
        .select('property_id, overdue_amount, is_overdue, days_overdue, penalty_amount, total_due')
        .order('property_id'), { tiebreaker: null }),
      // Each homeowner's monthly dues = lot size x price per sqm, computed by the database.
      fetchAll(() => supabase
        .from('property_monthly_dues')
        .select('property_id, monthly_dues')
        .order('property_id'), { tiebreaker: null }),
    ])

    if (request !== requestRef.current) return
    const errors = [
      profileResult.error, propertyResult.error, paymentResult.error,
      serviceResult.error, activityResult.error, settingsResult.error,
      overdueResult.error, duesResult.error,
    ].filter(Boolean)
    const arrays = [profileResult, propertyResult, paymentResult,
      serviceResult, activityResult, overdueResult, duesResult]
    if (errors.length || !arrays.every((item) => Array.isArray(item.data)) ||
        !settingsResult.data || typeof settingsResult.data !== 'object') {
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
    setPaidPropertyIds(new Set(serviceResult.data.map((row) => Number(row.property_id))))
    setOverdueSummaries(overdueResult.data)
    setActivities(activityResult.data)
    setDuesByProperty(new Map(duesResult.data.map((row) => [Number(row.property_id), row.monthly_dues])))
    setPenaltySettings({
      dueDay: Number(settingsResult.data.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data.late_penalty) || 0,
    })
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

  const activeProperties = useMemo(
    () => properties.filter((property) => (property.homeowner_status || 'active') === 'active'),
    [properties],
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

  // Sum in whole centavos so peso amounts never pick up floating-point drift.
  const monthlyDuesTarget = activeProperties.reduce(
    (sum, property) => sum + Math.round((Number(duesByProperty.get(Number(property.id))) || 0) * 100),
    0,
  ) / 100
  const overdueByProperty = useMemo(
    () => new Map(overdueSummaries.map((row) => [Number(row.property_id), row])),
    [overdueSummaries],
  )

  const overdueSummary = useMemo(() => {
    let count = 0
    let outstanding = 0

    activeProperties.forEach((property) => {
      const status = overdueByProperty.get(Number(property.id))
      const balance = Math.max(Number(property.current_balance) || 0, 0)

      if (status?.is_overdue && balance > 0) {
        count += 1
        outstanding += Math.min(Number(status.overdue_amount) || 0, balance)
      }
    })

    return { count, outstanding }
  }, [activeProperties, overdueByProperty])

  const accountStatus = useMemo(() => {
    let paid = 0
    let balanceDue = 0
    let noRecord = 0

    activeProperties.forEach((property) => {
      const owed = (Number(property.current_balance) || 0) > 0
      const hasPayment = paidPropertyIds.has(Number(property.id))

      if (owed) {
        balanceDue += 1
      } else if (hasPayment) {
        paid += 1
      } else {
        noRecord += 1
      }
    })

    return {
      paid,
      balanceDue,
      noRecord,
      total: activeProperties.length,
    }
  }, [paidPropertyIds, activeProperties])

  const recentActivities = useMemo(() => {
    const profilesById = new Map(
      profiles.map((profile) => [profile.id, profile]),
    )

    return activities.map((activity) => {
      const profile = profilesById.get(activity.user_id)
      const name =
        profile?.full_name || profile?.email || 'System User'

      return {
        id: activity.id,
        initials: getInitials(name),
        name,
        action: activity.action || 'Performed an action',
        target: activity.target || 'No additional details',
        time: formatActivityTime(activity.created_at, organization.dateFormat),
      }
    })
  }, [activities, profiles])

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
              label: 'Collected',
              data: collectionsByMonth.values,
              backgroundColor: 'rgba(20,100,160,0.65)',
              borderColor: 'rgba(20,100,160,0.90)',
              borderWidth: 1.5,
              borderRadius: 8,
              borderSkipped: false,
              order: 2,
            },
            {
              type: 'line',
              label: 'Target',
              data: collectionsByMonth.labels.map(() => monthlyDuesTarget),
              borderColor: 'rgba(7,30,48,0.55)',
              borderDash: [6, 5],
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 0,
              fill: false,
              tension: 0,
              order: 1,
            },
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
          labels: ['Paid', 'Balance Due', 'No Payment Record'],
          datasets: [
            {
              data: [
                accountStatus.paid,
                accountStatus.balanceDue,
                accountStatus.noRecord,
              ],
              backgroundColor: [
                'rgba(26,138,96,0.82)',
                'rgba(212,146,10,0.82)',
                'rgba(192,57,43,0.82)',
              ],
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
      label: 'TOTAL HOMEOWNERS',
      value: dashboardUnavailable ? '—' : activeProperties.length.toLocaleString('en-PH'),
      footer: 'Active registered',
      trend: null,
      icon: Users,
      tone: 'blue',
    },
    {
      label: `TOTAL COLLECTIONS ${currentMonthLabel.split(' ')[0]?.toUpperCase() || ''}`,
      value: dashboardUnavailable ? '—' : peso.format(collectedThisMonth),
      fitAmount: true,
      footer: dashboardUnavailable ? 'Data not verified' : `${currentMonthCollection.receipts} homeowner receipt${currentMonthCollection.receipts === 1 ? '' : 's'}${servicesThisMonth > 0 ? ` · Services separately: ${peso.format(servicesThisMonth)}` : ''}`,
      trend: dashboardUnavailable || collectedTrendPercent === null
        ? null
        : `${collectedTrendPercent >= 0 ? '+' : ''}${collectedTrendPercent.toFixed(1)}% vs last month`,
      icon: DollarSign,
      tone: 'green',
    },
    {
      label: 'OVERDUE ACCOUNTS',
      value: dashboardUnavailable ? '—' : overdueSummary.count.toLocaleString('en-PH'),
      footer: dashboardUnavailable ? '—' : `${peso.format(overdueSummary.outstanding)} outstanding`,
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
      label: 'View All Data',
      description: 'System records and archives',
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

  const statusItems = [
    {
      label: 'Paid',
      value: accountStatus.paid,
      color: 'rgba(26,138,96,0.82)',
    },
    {
      label: 'Balance Due',
      value: accountStatus.balanceDue,
      color: 'rgba(212,146,10,0.82)',
    },
    {
      label: 'No Payment Record',
      value: accountStatus.noRecord,
      color: 'rgba(192,57,43,0.82)',
    },
  ]

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
          <h3 className="dash-chart-title">Monthly Collections</h3>
          <p className="dash-chart-subtitle">{dashboardUnavailable ? 'Reporting data unavailable' : monthRangeLabel}</p>
          {!dashboardUnavailable && monthlyDuesTarget > 0 && (
            <div className="dash-date-badge dash-target-badge">
              Target {peso.format(monthlyDuesTarget)} / mo
            </div>
          )}
          <canvas ref={barChartRef} height="130" style={{ visibility: dashboardUnavailable ? 'hidden' : 'visible' }} />
        </div>

        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Payment Status</h3>
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
              {statusItems.map((item) => {
                const percent = accountStatus.total
                  ? Math.round(
                      (item.value / accountStatus.total) * 100,
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
                        {dashboardUnavailable ? '—' : item.value}{' '}
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
            <h3>Latest Activity</h3>
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
                No activity has been recorded yet.
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