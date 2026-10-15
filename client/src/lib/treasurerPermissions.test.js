import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Source-contract tests: they read the REAL files, so a regression in the permission
// checks fails here. They verify UI gating only; database authorization is covered by
// supabase/tests/treasurer_permissions.local.sql.
const here = dirname(fileURLToPath(import.meta.url))
const read = (relative) => readFileSync(resolve(here, '..', relative), 'utf8')

const sidebar = read('components/Sidebar.jsx')
const homeowners = read('pages/HomeownersPage.jsx')
const payments = read('pages/PaymentsPage.jsx')
const ledger = read('pages/LedgerPage.jsx')
const contacts = read('pages/ContactManagerPage.jsx')
const app = read('App.jsx')
const migration = readFileSync(
  resolve(here, '../../../supabase/migrations/20261015120000_restrict_treasurer_to_read_only_and_new_payments.sql'),
  'utf8',
)

const rolesOf = (source, path) => {
  const match = source.match(new RegExp(`path: '${path}',[\\s\\S]*?roles: \\[([^\\]]*)\\]`))
  return match ? match[1].match(/'(\w+)'/g).map((role) => role.replace(/'/g, '')).sort() : null
}
const assignment = (source, name) => {
  const match = source.match(new RegExp(`const ${name} =\\s*([^\\n]+(?:\\n\\s+\\|\\|[^\\n]+)*)`))
  return match ? match[1].replace(/\s+/g, ' ').trim() : null
}

describe('Treasurer can view homeowners and financial data', () => {
  it('shows the Homeowners sidebar item to admin, secretary and treasurer', () => {
    expect(rolesOf(sidebar, '/homeowners')).toEqual(['admin', 'secretary', 'treasurer'])
  })
  it('still shows Payments, Ledger and Contact Manager to treasurer', () => {
    for (const path of ['/payments', '/ledger', '/contacts']) {
      expect(rolesOf(sidebar, path)).toContain('treasurer')
    }
  })
  it('keeps the /homeowners, /payments and /ledger routes open to treasurer', () => {
    for (const path of ['/homeowners/:homeownerId?', '/payments', '/ledger']) {
      const route = app.slice(app.indexOf(`path="${path}"`), app.indexOf(`path="${path}"`) + 220)
      expect(route).toContain("'treasurer'")
    }
  })
})

describe('Treasurer can record new payments but not change existing records', () => {
  it('keeps Record Payment available to treasurer', () => {
    expect(assignment(payments, 'canManagePayments')).toContain("role === 'treasurer'")
    expect(payments).toMatch(/\{canManagePayments && \(\s*<button className="payments-primary"[^>]*onClick=\{openForm\}/)
  })
  it('limits voiding payments to the secretary on both pages', () => {
    expect(assignment(payments, 'canVoidPayments')).toBe("role === 'secretary'")
    expect(assignment(homeowners, 'canVoidPayments')).toBe("userRole === 'secretary'")
  })
  it('limits Add Charge / View Charges (direct balance changes) to admin and secretary', () => {
    expect(assignment(payments, 'canManageCharges')).toBe("role === 'admin' || role === 'secretary'")
    expect(payments).toMatch(/\{canManageCharges && \(\s*<button[\s\S]{0,120}?onClick=\{openChargeForm\}/)
    expect(payments).toMatch(/\{canManageCharges && \(\s*<button[\s\S]{0,160}?setShowCharges\(true\)/)
    expect(payments).toContain('{showCharge && canManageCharges && (')
    expect(payments).toContain('{showCharges && canManageCharges && (')
    expect(payments).not.toMatch(/(showCharge|showCharges) && canManagePayments/)
  })
  it('hides Edit Contact on the homeowner profile from treasurer', () => {
    expect(assignment(homeowners, 'canEditContact')).toBe("userRole === 'admin' || userRole === 'secretary'")
    expect(homeowners).toMatch(/\{canEditContact && \(\s*<button[\s\S]{0,160}?contacts\?edit=/)
  })
  it('keeps homeowner and contact editing admin/secretary only', () => {
    expect(assignment(ledger, 'canManageHomeowners')).toBe("role === 'admin' || role === 'secretary'")
    expect(assignment(contacts, 'canManageContacts')).toBe("role === 'admin' || role === 'secretary'")
  })
})

describe('Admin and Secretary are unchanged', () => {
  it('secretary can still void payments and add/void charges', () => {
    expect(assignment(payments, 'canVoidPayments')).toContain('secretary')
    expect(assignment(payments, 'canManageCharges')).toContain('secretary')
    expect(assignment(payments, 'canManageCharges')).toContain('admin')
  })
})

describe('Migration removes treasurer from the write paths', () => {
  const sql = migration.replace(/--.*$/gm, '')
  it('does not mention treasurer in any allow-list', () => {
    expect(sql).not.toMatch(/'treasurer'/i)
  })
  it('never drops policies, disables RLS or touches data', () => {
    expect(sql).not.toMatch(/drop\s+policy|disable\s+row\s+level|\bdelete\s+from\b|\btruncate\b|\binsert\s+into\b/i)
  })
})
