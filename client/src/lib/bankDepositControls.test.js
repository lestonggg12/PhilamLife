import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

const app = read('../App.jsx')
const sidebar = read('../components/Sidebar.jsx')
const migration = read('../../../supabase/migrations/20261113070156_disable_retired_bank_deposit_access.sql')

describe('Retired Bank Deposits security', () => {
  it('removes the retired page and route', () => {
    expect(app).not.toContain('BankDepositsPage')
    expect(app).not.toContain('path="/bank-deposits"')
    expect(sidebar).not.toContain('/bank-deposits')
  })

  it('revokes execution of all seven retired bank functions', () => {
    const functions = [
      'create_deposit_fund',
      'record_bank_deposit',
      'link_bank_deposit_receipt',
      'unlink_bank_deposit_receipt',
      'clear_bank_deposit',
      'reconcile_bank_deposit',
      'void_pending_bank_deposit',
    ]

    for (const name of functions) {
      expect(migration).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION\\s+public\\.${name}\\(`, 'i'),
      )
    }

    expect(migration.match(/FROM PUBLIC, authenticated;/g))
      .toHaveLength(functions.length)
  })

  it('does not delete historical database tables', () => {
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(migration).not.toMatch(/\bTRUNCATE\b/i)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})
