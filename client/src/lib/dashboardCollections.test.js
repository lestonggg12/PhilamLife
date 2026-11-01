import { describe, expect, it } from 'vitest'
import { monthlyCollection } from './dashboardCollections'

describe('dashboard monthly collection scopes', () => {
  const november = { dues_collected: '60000', dues_receipts: 3, dues_only_collected: '20000', dues_only_receipts: 1, balance_collected: '40000', service_collected: '500' }
  it('Admin includes Balance Payments in total homeowner receipts, services stay separate', () => {
    expect(monthlyCollection(november, 'admin')).toEqual({ amount: 60000, receipts: 3 })
  })
  it('Secretary shows only association dues and the matching receipt count', () => {
    expect(monthlyCollection(november, 'secretary')).toEqual({ amount: 20000, receipts: 1 })
  })
  it('does not fall back to all cash when dues are zero or absent', () => {
    expect(monthlyCollection({ dues_collected: 40000, dues_receipts: 2 }, 'secretary')).toEqual({ amount: 0, receipts: 0 })
  })
  it('handles a month without any receipts', () => {
    expect(monthlyCollection(undefined, 'admin')).toEqual({ amount: 0, receipts: 0 })
    expect(monthlyCollection(undefined, 'secretary')).toEqual({ amount: 0, receipts: 0 })
  })
  it('uses recorded cash rather than annual-discount face values', () => {
    expect(monthlyCollection({ dues_collected: '10450', dues_only_collected: '10450', dues_only_receipts: 1 }, 'secretary').amount).toBe(10450)
  })
})
