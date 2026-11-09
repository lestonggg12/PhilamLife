import { expect, it } from 'vitest'
import { summarizeAdminAccounts } from './adminDashboardAccounts'

const properties = [
  { id: 1, homeowner_id: 'owner-a', homeowner_status: 'active', current_balance: '200.00' },
  { id: 2, homeowner_id: 'owner-a', homeowner_status: 'active', current_balance: '-100.00' },
  { id: 3, homeowner_id: 'owner-b', homeowner_status: 'active', current_balance: '0.00' },
  { id: 4, homeowner_id: 'owner-c', homeowner_status: 'transferred', current_balance: '900.00' },
]
const aging = [
  { property_id: 1, balance: '200.00', overdue_amount: '150.00', days_overdue: 15, aging_complete: true },
  { property_id: 2, balance: '0.00', overdue_amount: '0.00', aging_complete: true },
  { property_id: 3, balance: '0.00', overdue_amount: '0.00', aging_complete: true },
]
const dues = [
  { property_id: 1, monthly_dues: '100.01' },
  { property_id: 2, monthly_dues: '200.02' },
  { property_id: 3, monthly_dues: '300.03' },
  { property_id: 4, monthly_dues: '900.00' },
]

it('counts lots and owners separately and distinguishes credit from a zero balance', () => {
  const snapshot = summarizeAdminAccounts(properties, aging, dues)
  expect(snapshot.balances).toEqual({ total: 3, balanceDue: 1, advanceCredit: 1, clear: 1 })
  expect(snapshot.owners).toBe(2)
  expect(snapshot.monthlyDuesTarget).toBe(600.06)
  expect(snapshot.overdue).toMatchObject({ overdueCount: 1, overdueBalance: 150, currentPortion: 50, reviewCount: 0 })
})

it('flags aging that disagrees with the balance and does not publish a partial target', () => {
  const snapshot = summarizeAdminAccounts(properties, [
    { ...aging[0], balance: '199.00' }, aging[1], aging[2],
  ], dues.slice(1))
  expect(snapshot.overdue).toMatchObject({ overdueCount: 0, reviewCount: 1 })
  expect(snapshot.monthlyDuesTarget).toBeNull()
})
