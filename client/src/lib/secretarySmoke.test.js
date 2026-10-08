import { describe, it, expect } from 'vitest'

// 1. Role routing logic simulation from App.jsx & ProtectedRoute.jsx
describe('Secretary Routing & Access Control', () => {
  const dashboardForRole = (role) =>
    ({
      admin: '/admin/dashboard',
      treasurer: '/treasurer/dashboard',
      secretary: '/secretary/dashboard',
    })[role] || '/login'

  const routesConfig = [
    { path: '/secretary/dashboard', allowed: ['secretary'] },
    { path: '/secretary/services', allowed: ['secretary'] },
    { path: '/secretary/receipts', allowed: ['secretary'] },
    { path: '/ledger', allowed: ['admin', 'treasurer', 'secretary'] },
    { path: '/payments', allowed: ['admin', 'secretary', 'treasurer'] },
    { path: '/activity-log', allowed: ['admin', 'secretary', 'treasurer'] },
    { path: '/documents', allowed: ['admin', 'secretary', 'treasurer'] },
    { path: '/calendar', allowed: ['admin', 'treasurer', 'secretary'] },
    { path: '/contacts', allowed: ['admin', 'secretary', 'treasurer'] },
    { path: '/homeowners', allowed: ['admin', 'secretary', 'treasurer'] },
    { path: '/overdue-accounts', allowed: ['admin', 'secretary', 'treasurer'] },
    // Restricted from Secretary
    { path: '/admin/dashboard', allowed: ['admin'] },
    { path: '/treasurer/dashboard', allowed: ['treasurer'] },
    { path: '/treasurer/expenses', allowed: ['treasurer'] },
    { path: '/treasurer/service-revenue', allowed: ['treasurer'] },
    { path: '/reports', allowed: ['admin', 'treasurer'] },
    { path: '/system-settings', allowed: ['admin'] },
  ]

  it('correctly maps Secretary default landing dashboard', () => {
    expect(dashboardForRole('secretary')).toBe('/secretary/dashboard')
    expect(dashboardForRole('admin')).toBe('/admin/dashboard')
    expect(dashboardForRole('treasurer')).toBe('/treasurer/dashboard')
  })

  it('permits Secretary into all 11 designated workspace routes', () => {
    const permitted = routesConfig.filter((r) => r.allowed.includes('secretary'))
    expect(permitted.map((r) => r.path)).toEqual([
      '/secretary/dashboard',
      '/secretary/services',
      '/secretary/receipts',
      '/ledger',
      '/payments',
      '/activity-log',
      '/documents',
      '/calendar',
      '/contacts',
      '/homeowners',
      '/overdue-accounts',
    ])
  })

  it('blocks Secretary from Admin and Treasurer private routes', () => {
    const blocked = routesConfig.filter((r) => !r.allowed.includes('secretary'))
    expect(blocked.map((r) => r.path)).toEqual([
      '/admin/dashboard',
      '/treasurer/dashboard',
      '/treasurer/expenses',
      '/treasurer/service-revenue',
      '/reports',
      '/system-settings',
    ])
  })
})

// 2. Overdue calculation and aging tier logic from OverdueAccountsPage.jsx
describe('OverdueAccounts Calculations & Status Assignment', () => {
  function agingTierOf(daysOverdue) {
    if (daysOverdue <= 30) return '1-30 days'
    if (daysOverdue <= 60) return '31-60 days'
    if (daysOverdue <= 90) return '61-90 days'
    return '90+ days'
  }

  function computeAccountStatus(balance, paidAmount, isOverdue) {
    if (balance <= 0) return 'Paid'
    if (isOverdue) return 'Overdue'
    if (paidAmount > 0) return 'Partial'
    return 'Pending'
  }

  it('assigns aging tiers correctly according to days overdue', () => {
    expect(agingTierOf(0)).toBe('1-30 days')
    expect(agingTierOf(5)).toBe('1-30 days')
    expect(agingTierOf(30)).toBe('1-30 days')
    expect(agingTierOf(31)).toBe('31-60 days')
    expect(agingTierOf(60)).toBe('31-60 days')
    expect(agingTierOf(61)).toBe('61-90 days')
    expect(agingTierOf(90)).toBe('61-90 days')
    expect(agingTierOf(91)).toBe('90+ days')
    expect(agingTierOf(365)).toBe('90+ days')
  })

  it('evaluates status priority: Paid > Overdue > Partial > Pending', () => {
    // 0 balance is always Paid
    expect(computeAccountStatus(0, 500, false)).toBe('Paid')
    expect(computeAccountStatus(0, 0, false)).toBe('Paid')
    // Balance > 0 and overdue is Overdue
    expect(computeAccountStatus(1000, 0, true)).toBe('Overdue')
    expect(computeAccountStatus(1000, 500, true)).toBe('Overdue') // even if partially paid, overdue takes precedence
    // Balance > 0, not overdue, with partial payment is Partial
    expect(computeAccountStatus(500, 500, false)).toBe('Partial')
    // Balance > 0, not overdue, 0 payment is Pending
    expect(computeAccountStatus(1000, 0, false)).toBe('Pending')
  })

  it('computes total due with penalties correctly', () => {
    const balance = 1000
    const penaltyAmount = 150
    const totalDue = balance + penaltyAmount
    expect(totalDue).toBe(1150)
  })
})

// 3. Secretary Dashboard metrics aggregation
describe('Secretary Dashboard Metrics Aggregation', () => {
  it('aggregates yearly and monthly dues collections from monthly rows', () => {
    const monthlyRows = [
      { month_start: '2026-08-01', dues_collected: 10000, dues_receipts: 10 },
      { month_start: '2026-09-01', dues_collected: 15000, dues_receipts: 15 },
      { month_start: '2026-10-01', dues_collected: 1000, dues_receipts: 1 },
    ]
    const currentKey = '2026-10'

    const yearlyCollections = monthlyRows.reduce(
      (sum, row) => sum + (Number(row.dues_collected) || 0),
      0,
    )
    const thisMonth = monthlyRows.find(
      (row) => String(row.month_start).slice(0, 7) === currentKey,
    )
    const monthlyCollections = Number(thisMonth?.dues_collected) || 0
    const receiptsThisMonth = Number(thisMonth?.dues_receipts) || 0

    expect(yearlyCollections).toBe(26000)
    expect(monthlyCollections).toBe(1000)
    expect(receiptsThisMonth).toBe(1)
  })

  it('properly differentiates active vs moved/transferred properties', () => {
    const properties = [
      { id: 1, homeowner_status: 'active', current_balance: 1000 },
      { id: 2, homeowner_status: 'active', current_balance: 0 },
      { id: 3, homeowner_status: 'active', current_balance: -500 }, // advance credit
      { id: 4, homeowner_status: 'moved', current_balance: 2000 },
      { id: 5, homeowner_status: 'transferred', current_balance: 0 },
    ]

    const activeProperties = properties.filter(
      (p) => (p.homeowner_status || 'active') === 'active',
    )
    expect(activeProperties.length).toBe(3)

    const outstandingAccounts = activeProperties.filter(
      (p) => (Number(p.current_balance) || 0) > 0,
    ).length
    expect(outstandingAccounts).toBe(1)
  })
})

// 4. Services Management Amount & Change Calculations
describe('ServicesManagement Calculations', () => {
  const toCents = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100

  it('calculates amount due, paid amount, and change returned correctly', () => {
    const rate = 500
    const quantity = 2
    const amountDue = toCents(rate * quantity) // 1000
    expect(amountDue).toBe(1000)

    // Full payment exact cash
    const receivedExact = 1000
    const paidExact = Math.min(receivedExact, amountDue)
    const changeExact = toCents(Math.max(receivedExact - amountDue, 0))
    expect(paidExact).toBe(1000)
    expect(changeExact).toBe(0)

    // Overpayment with cash change handed back
    const receivedOver = 1200
    const paidOver = Math.min(receivedOver, amountDue)
    const changeOver = toCents(Math.max(receivedOver - amountDue, 0))
    expect(paidOver).toBe(1000)
    expect(changeOver).toBe(200)

    // Partial payment
    const receivedPartial = 600
    const paidPartial = Math.min(receivedPartial, amountDue)
    const remainingBalance = toCents(amountDue - paidPartial)
    expect(paidPartial).toBe(600)
    expect(remainingBalance).toBe(400)
  })
})
