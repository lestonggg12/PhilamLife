import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql = readFileSync(new URL('../../../supabase/migrations/20261112120000_bank_deposit_receipt_matching.sql', import.meta.url), 'utf8')
const page = readFileSync(new URL('../pages/BankDepositsPage.jsx', import.meta.url), 'utf8')
const component = readFileSync(new URL('../components/BankDepositReceiptMatcher.jsx', import.meta.url), 'utf8')

describe('deposit receipt matching contracts', () => {
  it('limits receipt linking to the Treasurer and prevents direct table writes', () => {
    expect(sql).toContain("public.current_user_role() IS DISTINCT FROM 'treasurer'")
    expect(sql).toContain('REVOKE ALL ON public.bank_deposit_receipt_links')
    expect(component).toContain("supabase.rpc('link_bank_deposit_receipt'")
    expect(component).not.toMatch(/from\('bank_deposit_receipt_links'\)\s*\.\s*(insert|upsert|update|delete)\(/)
  })
  it('supports partial deposits without overallocating or using billed balances', () => {
    expect(sql).toContain('coalesce(amount_paid,amount)')
    expect(sql).toContain('v_total+p_amount > v_deposit.amount')
    expect(sql).toContain('p_amount > v_available')
    expect(sql).toContain('FOR UPDATE')
  })
  it('keeps final reconciliation blocked and voided deposits unlinked', () => {
    expect(sql).toContain('Leave final reconciliation disabled')
    expect(sql).toContain('Treasurer must unlink all receipts before a pending deposit can be voided.')
    expect(page).toContain('BankDepositReceiptMatcher')
  })
})
