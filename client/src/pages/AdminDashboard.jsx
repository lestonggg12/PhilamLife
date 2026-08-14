import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './AdminDashboard.css'
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
import { computeLateFee } from '../lib/latepenalty'
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

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeLot(value) {
  return normalize(value).replace(/^lot\s*/, '')
}

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

function getLastSixMonths() {
  const currentKey = manilaMonthKey()
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

function isVoided(payment) {
  return normalize(payment.status) === 'voided'
}

function paymentMatchesProperty(payment, property) {
  if (
    payment.property_id != null &&
    Number(payment.property_id) === Number(property.id)
  ) {
    return true
  }

  return (
    normalize(payment.homeowner_name) ===
      normalize(property.homeowner_name) &&
    normalize(payment.block_name) === normalize(property.block) &&
    normalizeLot(payment.lot_number) === normalizeLot(property.lot_number)
  )
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
  const [payments, setPayments] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [activities, setActivities] = useState([])
  const [duesAmount, setDuesAmount] = useState(0)
  const [penaltySettings, setPenaltySettings] = useState({
    dueDay: 5,
    gracePeriodDays: 0,
    latePenalty: 0,
  })
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    setPageError('')

    const [
      profileResult,
      propertyResult,
      paymentResult,
      serviceResult,
      activityResult,
      settingsResult,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active'),
      supabase
        .from('properties')
        .select('id, block, lot_number, homeowner_name, homeowner_status'),
      supabase
        .from('payments')
        .select(
          'id, property_id, amount_paid, status, paid_at, homeowner_name, block_name, lot_number, remaining_balance',
        )
        .order('paid_at', { ascending: false }),
      supabase
        .from('service_transactions')
        .select('id, amount_paid, paid_at'),
      supabase
        .from('activity_log')
        .select('id, user_id, action, target, created_at')
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('system_settings')
        .select('dues_amount, due_day, grace_period_days, late_penalty')
        .eq('id', 1)
        .maybeSingle(),
    ])

    const errors = [
      profileResult.error,
      propertyResult.error,
      paymentResult.error,
      serviceResult.error,
      activityResult.error,
    ].filter(Boolean)

    if (errors.length > 0) {
      setPageError(
        `Some dashboard information could not be loaded: ${errors
          .map((error) => error.message)
          .join(' ')}`,
      )
    }

    setProfiles(profileResult.data || [])
    setProperties(propertyResult.data || [])
    setPayments(paymentResult.data || [])
    setServiceTransactions(serviceResult.data || [])
    setActivities(activityResult.data || [])
    setDuesAmount(Number(settingsResult.data?.dues_amount) || 0)
    setPenaltySettings({
      dueDay: Number(settingsResult.data?.due_day) || 5,
      gracePeriodDays: Number(settingsResult.data?.grace_period_days) || 0,
      latePenalty: Number(settingsResult.data?.late_penalty) || 0,
    })
    setLoading(false)
  }

  const activePayments = useMemo(
    () => payments.filter((payment) => !isVoided(payment)),
    [payments],
  )

  const activeProperties = useMemo(
    () => properties.filter((property) => (property.homeowner_status || 'active') === 'active'),
    [properties],
  )

  const sixMonths = useMemo(() => getLastSixMonths(), [])

  const collectionsByMonth = useMemo(() => {
    const totals = new Map(sixMonths.map((month) => [month.key, 0]))

    activePayments.forEach((payment) => {
      const key = manilaMonthKey(payment.paid_at)
      if (totals.has(key)) {
        totals.set(key, totals.get(key) + (Number(payment.amount_paid) || 0))
      }
    })

    serviceTransactions.forEach((transaction) => {
      const key = manilaMonthKey(transaction.paid_at)
      if (totals.has(key)) {
        totals.set(key, totals.get(key) + (Number(transaction.amount_paid) || 0))
      }
    })

    return {
      labels: sixMonths.map((month) => month.label),
      values: sixMonths.map((month) => totals.get(month.key) || 0),
    }
  }, [sixMonths, activePayments, serviceTransactions])

  const currentMonthLabel = sixMonths[sixMonths.length - 1]?.label || ''
  const collectedThisMonth = collectionsByMonth.values[collectionsByMonth.values.length - 1] || 0
  const collectedLastMonth = collectionsByMonth.values[collectionsByMonth.values.length - 2] || 0
  const collectedTrendPercent = collectedLastMonth > 0
    ? ((collectedThisMonth - collectedLastMonth) / collectedLastMonth) * 100
    : null

  const monthlyDuesTarget = activeProperties.length * duesAmount

  const overdueSummary = useMemo(() => {
    let count = 0
    let outstanding = 0

    activeProperties.forEach((property) => {
      const latestPayment = activePayments.find((payment) =>
        paymentMatchesProperty(payment, property),
      )
      const balance = latestPayment
        ? Number(latestPayment.remaining_balance) || 0
        : duesAmount

      const lateFee = computeLateFee({
        balance,
        dueDay: penaltySettings.dueDay,
        gracePeriodDays: penaltySettings.gracePeriodDays,
        latePenalty: penaltySettings.latePenalty,
      })

      if (lateFee.isOverdue && balance > 0) {
        count += 1
        outstanding += balance
      }
    })

    return { count, outstanding }
  }, [activeProperties, activePayments, duesAmount, penaltySettings])

  const accountStatus = useMemo(() => {
    let paid = 0
    let balanceDue = 0
    let noRecord = 0

    activeProperties.forEach((property) => {
      const latestPayment = activePayments.find((payment) =>
        paymentMatchesProperty(payment, property),
      )

      if (!latestPayment) {
        noRecord += 1
        return
      }

      const remainingBalance = Number(latestPayment.remaining_balance)
      if (Number.isFinite(remainingBalance) && remainingBalance > 0) {
        balanceDue += 1
      } else {
        paid += 1
      }
    })

    return {
      paid,
      balanceDue,
      noRecord,
      total: activeProperties.length,
    }
  }, [activePayments, activeProperties])

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
    if (loading) return undefined

    chartInstancesRef.current.forEach((chart) => chart.destroy())
    chartInstancesRef.current = []

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
    loading,
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
      value: loading ? '—' : activeProperties.length.toLocaleString('en-PH'),
      footer: 'Active registered',
      trend: null,
      icon: Users,
      tone: 'blue',
    },
    {
      label: `COLLECTED ${currentMonthLabel.split(' ')[0]?.toUpperCase() || ''}`,
      value: loading ? '—' : peso.format(collectedThisMonth),
      footer: monthlyDuesTarget > 0
        ? `vs ${peso.format(monthlyDuesTarget)} target`
        : 'Dues and amenity revenue',
      trend: collectedTrendPercent === null
        ? null
        : `${collectedTrendPercent >= 0 ? '+' : ''}${collectedTrendPercent.toFixed(1)}% vs last month`,
      icon: DollarSign,
      tone: 'green',
    },
    {
      label: 'OVERDUE ACCOUNTS',
      value: loading ? '—' : overdueSummary.count.toLocaleString('en-PH'),
      footer: loading ? '—' : `${peso.format(overdueSummary.outstanding)} outstanding`,
      trend: null,
      icon: AlertCircle,
      tone: 'red',
    },
    {
      label: 'ACTIVE USERS',
      value: loading ? '—' : activeUserCount.toLocaleString('en-PH'),
      footer: loading ? 'Loading accounts' : (activeRoleLabels.join(', ') || 'No active accounts'),
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
          <h1 className="dash-page-title">Admin Dashboard</h1>
          <p className="dash-page-subtitle">
            {organization.hoaName} · {currentMonthLabel}
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
            <div className="dash-stat-value">{stat.value}</div>
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
          <p className="dash-chart-subtitle">{monthRangeLabel}</p>
          {monthlyDuesTarget > 0 && (
            <div className="dash-date-badge dash-target-badge">
              Target {peso.format(monthlyDuesTarget)} / mo
            </div>
          )}
          <canvas ref={barChartRef} height="130" />
        </div>

        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Payment Status</h3>
          <p className="dash-chart-subtitle">
            {loading ? 'Loading…' : `${accountStatus.total.toLocaleString('en-PH')} total properties`}
          </p>
          <div className="dash-donut-container">
            <div className="dash-donut-canvas">
              <canvas ref={donutChartRef} />
              <div className="dash-donut-center">
                <div className="dash-donut-value">
                  {loading ? '—' : accountStatus.total}
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
                        {loading ? '—' : item.value}{' '}
                        <span>{loading ? '—' : `${percent}%`}</span>
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
              <p className="dash-empty-state">Loading activity...</p>
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