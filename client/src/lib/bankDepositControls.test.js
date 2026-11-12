
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(
  new URL('../pages/BankDepositsPage.jsx', import.meta.url),
  'utf8',
)

const app = readFileSync(
  new URL('../App.jsx', import.meta.url),
  'utf8',
)

const sidebar = readFileSync(
  new URL('../components/Sidebar.jsx', import.meta.url),
  'utf8',
)

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261112090000_controlled_bank_deposit_workflow.sql', import.meta.url),
  'utf8',
)

describe('Bank deposit security checks', () => {
  it('protects the deposit route for staff', () => {
    expect(app).toContain('/bank-deposits')
    expect(app).toMatch(
      /guarded\(\s*\['admin',\s*'treasurer',\s*'secretary'\]/,
    )
    expect(sidebar).toContain('/bank-deposits')
  })

  it('separates Admin and Treasurer actions', () => {
    expect(page).toContain("role === 'admin'")
    expect(page).toContain("role === 'treasurer'")
    expect(page).toContain('ready && canAdmin')
    expect(page).toContain('ready && canTreasurer')
    expect(page).toContain("role === 'secretary'")
  })

  it('uses controlled deposit functions', () => {
    const functions = [
      'create_deposit_fund',
      'record_bank_deposit',
      'clear_bank_deposit',
      'reconcile_bank_deposit',
      'void_pending_bank_deposit',
    ]

    for (const name of functions) {
      expect(page).toContain(name)
      expect(migration).toContain(`public.${name}`)
    }

    expect(page).not.toMatch(
      /from\(['"]bank_deposits['"]\)\s*\.\s*(?:insert|update|delete|upsert)\s*\(/,
    )
  })

  it('contains database security controls', () => {
    expect(migration).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON public.bank_deposits',
    )
    expect(migration).toContain(
      'FOREIGN KEY (fund_id) REFERENCES public.deposit_funds(id)',
    )
    expect(migration).toContain(
      'bank_deposit_status_evidence_check',
    )
  })
})
