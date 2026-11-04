import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const secretary = readFileSync(
  new URL('../pages/ServicesManagementPage.jsx', import.meta.url),
  'utf8',
)

const treasurer = readFileSync(
  new URL('../pages/TreasurerServiceRevenuePage.jsx', import.meta.url),
  'utf8',
)

const dialog = readFileSync(
  new URL('../components/ServiceVoidDialog.jsx', import.meta.url),
  'utf8',
)

const migration = readFileSync(
  new URL('../../../supabase/migrations/20261104143024_harden_staff_service_receipt_void_role_validation.sql', import.meta.url),
  'utf8',
)

describe('Service receipt voiding', () => {
  it('makes voiding available to Secretary', () => {
    expect(secretary).toContain('<ServiceVoidDialog')
    expect(secretary).toContain('setVoidTarget(item)')
    expect(secretary).toContain("item.payment_status !== 'voided'")
  })

  it('makes voiding available to Treasurer', () => {
    expect(treasurer).toContain('<ServiceVoidDialog')
    expect(treasurer).toContain('setVoidTarget(t)')
    expect(treasurer).toContain("t.payment_status !== 'voided'")
  })

  it('requires a reason and explicit confirmation', () => {
    expect(dialog).toContain('minLength={5}')
    expect(dialog).toContain('maxLength={500}')
    expect(dialog).toContain('Confirm Void')
    expect(dialog).toContain('reason.trim()')
  })

  it('uses the secured RPC instead of direct UPDATE', () => {
    expect(dialog).toContain("'void_service_receipt'")
    expect(dialog).not.toContain(".update(")
  })

  it('restricts voiding to active Secretary or Treasurer', () => {
    expect(migration).toContain('public.current_user_role()')
    expect(migration).toContain("coalesce(public.current_user_role(), '')")
    expect(migration).toContain("'secretary', 'treasurer'")
  })

  it('prevents voiding originals with active settlements', () => {
    expect(migration).toContain('child.balance_of = target.id')
    expect(migration).toContain("child.payment_status <> 'voided'")
  })

  it('records an audit reason and user', () => {
    expect(migration).toContain("payment_status = 'voided'")
    expect(migration).toContain('voided_at = now()')
    expect(migration).toContain('voided_by = auth.uid()')
    expect(migration).toContain('void_reason = reason_text')
  })
})