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
  Check,
  Clock,
  Zap,
} from '../components/Icons'
import { supabase } from '../lib/supabaseClient'

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

const activityDateFormatter = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: MANILA_TIME_ZONE,
})

const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const chartColors = [
  'rgba(20,100,160,0.65)',
  'rgba(26,138,96,0.65)',
  'rgba(108,60,160,0.65)',
  'rgba(212,146,10,0.80)',
  'rgba(192,57,43,0.65)',
  'rgba(42,96,128,0.72)',
]

const chartBorders = [
  'rgba(20,100,160,0.90)',
  'rgba(26,138,96,0.90)',
  'rgba(108,60,160,0.90)',
  'rgba(212,146,10,0.95)',
  'rgba(192,57,43,0.90)',
  'rgba(42,96,128,0.95)',
]

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

function formatActivityTime(value) {
  if (!value) return 'Time unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : activityDateFormatter.format(date)
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const barChartRef = useRef(null)
  const donutChartRef = useRef(null)
  const chartInstancesRef = useRef([])

  const [profiles, setProfiles] = useState([])
  const [properties, setProperties] = useState([])
  const [payments, setPayments] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [chartError, setChartError] = useState('')
  const [chartsReady, setChartsReady] = useState(
    () => typeof window !== 'undefined' && Boolean(window.Chart),
  )
  const [actionsOpen, setActionsOpen] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [])

  useEffect(() => {
    if (window.Chart) {
      setChartsReady(true)
      return undefined
    }

    let script = document.getElementById('philam-chart-js')

    const handleLoad = () => {
      setChartError('')
      setChartsReady(Boolean(window.Chart))
    }

    const handleError = () => {
      setChartError('Charts could not be loaded. Dashboard totals remain available.')
    }

    if (!script) {
      script = document.createElement('script')
      script.id = 'philam-chart-js'
      script.src =
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
      script.async = true
      document.head.appendChild(script)
    }

    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)

    return () => {
      script?.removeEventListener('load', handleLoad)
      script?.removeEventListener('error', handleError)
    }
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
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active'),
      supabase
        .from('properties')
        .select('id, block, lot_number, homeowner_name'),
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
    setLoading(false)
  }

  const activePayments = useMemo(
    () => payments.filter((payment) => !isVoided(payment)),
    [payments],
  )

  const totalCollections = useMemo(() => {
    const dues = activePayments.reduce(
      (sum, payment) => sum + (Number(payment.amount_paid) || 0),
      0,
    )
    const amenityRevenue = serviceTransactions.reduce(
      (sum, transaction) =>
        sum + (Number(transaction.amount_paid) || 0),
      0,
    )

    return dues + amenityRevenue
  }, [activePayments, serviceTransactions])

  const sixMonths = useMemo(() => getLastSixMonths(), [])

  const paymentsByBlock = useMemo(() => {
    const validMonthKeys = new Set(sixMonths.map((month) => month.key))
    const totals = new Map()

    properties.forEach((property) => {
      const block = String(property.block || '').trim()
      if (block) totals.set(block, 0)
    })

    activePayments.forEach((payment) => {
      if (!payment.paid_at || !validMonthKeys.has(manilaMonthKey(payment.paid_at))) {
        return
      }

      const block = String(payment.block_name || 'Unassigned').trim()
      totals.set(block, (totals.get(block) || 0) + 1)
    })

    const sortedEntries = [...totals.entries()].sort(([left], [right]) =>
      left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    )

    return {
      labels: sortedEntries.map(([block]) => block),
      values: sortedEntries.map(([, total]) => total),
    }
  }, [activePayments, properties, sixMonths])

  const accountStatus = useMemo(() => {
    let paid = 0
    let balanceDue = 0
    let noRecord = 0

    properties.forEach((property) => {
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
      total: properties.length,
    }
  }, [activePayments, properties])

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
        time: formatActivityTime(activity.created_at),
      }
    })
  }, [activities, profiles])

  useEffect(() => {
    if (!chartsReady || loading || !window.Chart) return undefined

    chartInstancesRef.current.forEach((chart) => chart.destroy())
    chartInstancesRef.current = []

    if (barChartRef.current) {
      const barChart = new window.Chart(barChartRef.current, {
        type: 'bar',
        data: {
          labels: paymentsByBlock.labels,
          datasets: [
            {
              data: paymentsByBlock.values,
              backgroundColor: paymentsByBlock.labels.map(
                (_, index) => chartColors[index % chartColors.length],
              ),
              borderColor: paymentsByBlock.labels.map(
                (_, index) => chartBorders[index % chartBorders.length],
              ),
              borderWidth: 1.5,
              borderRadius: 8,
              borderSkipped: false,
            },
          ],
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
              callbacks: {
                label: (context) =>
                  `  ${context.parsed.y} payment${
                    context.parsed.y === 1 ? '' : 's'
                  }`,
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
                font: { size: 12, weight: '500' },
                precision: 0,
                stepSize: 1,
              },
            },
          },
        },
      })

      chartInstancesRef.current.push(barChart)
    }

    if (donutChartRef.current) {
      const donutChart = new window.Chart(donutChartRef.current, {
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
    chartsReady,
    loading,
    paymentsByBlock,
  ])

  const activeUserCount = profiles.filter(
    (profile) => profile.is_active !== false,
  ).length

  const systemStats = [
    {
      label: 'TOTAL USERS',
      value: loading ? '—' : profiles.length.toLocaleString('en-PH'),
      footer: loading
        ? 'Loading accounts'
        : `${activeUserCount.toLocaleString('en-PH')} active account${
            activeUserCount === 1 ? '' : 's'
          }`,
      icon: Users,
      color: '#1a8a60',
    },
    {
      label: 'PROPERTIES',
      value: loading ? '—' : properties.length.toLocaleString('en-PH'),
      footer: 'Registered lots',
      icon: Home,
      color: '#1a8a60',
    },
    {
      label: 'TOTAL COLLECTIONS',
      value: loading ? '—' : peso.format(totalCollections),
      footer: 'Dues and amenity revenue',
      icon: DollarSign,
      color: '#1a8a60',
    },
    {
      label: 'SYSTEM STATUS',
      value: loading ? 'Checking' : pageError ? 'Partial' : 'Live',
      footer: loading
        ? 'Connecting to database'
        : pageError
          ? 'Some data unavailable'
          : 'Live database connected',
      icon: pageError ? AlertCircle : Check,
      color: pageError ? '#c0392b' : '#2a6080',
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
        <h1 className="dash-page-title">Admin Dashboard</h1>
        <p className="dash-page-subtitle">
          Live overview of users, properties, collections, and system activity.
        </p>
      </div>

      {pageError && <p className="dash-page-error">{pageError}</p>}

      <div className="dash-stats-grid">
        {systemStats.map((stat) => (
          <div key={stat.label} className="dash-stat-card">
            <div className="dash-stat-top">
              <div className="dash-stat-label">{stat.label}</div>
              <div className="dash-stat-icon-box">
                <stat.icon size={18} />
              </div>
            </div>
            <div className="dash-stat-value">{stat.value}</div>
            <div className="dash-stat-footer">
              <TrendingUp size={13} color={stat.color} />
              <span>{stat.footer}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="dash-analytics-header">
        <h2 className="dash-section-title">Analytics Overview</h2>
        <span className="dash-section-link">Last 6 months</span>
      </div>

      {chartError && <p className="dash-chart-message">{chartError}</p>}

      <div className="dash-charts-grid">
        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Payments per Block</h3>
          <div className="dash-date-badge">{monthRangeLabel}</div>
          <canvas ref={barChartRef} height="120" />
          <div className="dash-bar-legend">
            {paymentsByBlock.labels.length === 0 ? (
              <p className="dash-empty-state">
                No payment records are available for this period.
              </p>
            ) : (
              paymentsByBlock.labels.map((block, index) => (
                <div className="dash-legend-item" key={block}>
                  <div
                    className="dash-legend-box"
                    style={{
                      background:
                        chartColors[index % chartColors.length],
                    }}
                  />
                  {block} — {paymentsByBlock.values[index]}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dash-chart-card">
          <h3 className="dash-chart-title">Property Payment Status</h3>
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
          <div className="dash-payment-stats">
            <div className="dash-stat-item">
              <span>
                {loading
                  ? 'Loading properties...'
                  : `${accountStatus.total.toLocaleString(
                      'en-PH',
                    )} registered properties`}
              </span>
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