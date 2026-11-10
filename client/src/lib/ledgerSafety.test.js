import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildLedgerStatement, ledgerStatementNotes } from './ledgerStatement'

describe('Ledger financial safety', () => {
  it('rejects malformed stored balances', () => {
    for (const value of ['invalid', '', 'NaN', 'Infinity', '0.001', '1,000.00', '99999999999999999999']) {
      expect(() => buildLedgerStatement({ storedBalance: value })).toThrow()
    }
  })

  it('rejects corrupt charges and payment amounts', () => {
    expect(() => buildLedgerStatement({
      storedBalance: 0,
      charges: [{ id: 'bad', amount: 'invalid' }],
    })).toThrow()

    expect(() => buildLedgerStatement({
      storedBalance: 0,
      payments: [{ id: 1, amount: null, amount_paid: null }],
    })).toThrow()

    expect(() => buildLedgerStatement({
      storedBalance: 0,
      payments: [{ id: 1, amount: 100, effect_released: 'invalid' }],
    })).toThrow()
  })

  it('preserves legitimate optional zero amounts', () => {
    const result = buildLedgerStatement({
      storedBalance: -100,
      payments: [{
        id: 1,
        amount: '100.00',
        amount_paid: '100.00',
        balance_effect: '100.00',
      }],
    })

    expect(result.totals.finalBalance).toBe(-100)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
  })

  it('requires documented monetary precision', () => {
    const result = buildLedgerStatement({
      storedBalance: '-0.01',
      payments: [{
        id: 1,
        amount: '0.01',
        amount_paid: '0.01',
        balance_effect: '0.01',
      }],
    })

    expect(result.totals.availableCredit).toBe(0.01)
    expect(result.totals.reconcilesWithStoredBalance).toBe(true)
  })

  it('discloses missing payment-to-charge allocations', () => {
    const result = buildLedgerStatement({
      storedBalance: -125,
      payments: [{
        id: 1,
        amount: '125.00',
        amount_paid: '125.00',
        balance_effect: '125.00',
      }],
    })

    const notes = ledgerStatementNotes(result.totals, String).join(' ')
    expect(notes).toContain('No individual bill-to-payment allocations')
    expect(notes).toContain('not verification')
  })

  it('lets full summary amounts wrap instead of clipping them', () => {
    const css = readFileSync(new URL('../pages/LedgerPage.css', import.meta.url), 'utf8')
    const valueStyle = css.match(/\.ledger-summary-value\s*\{([^}]+)\}/)?.[1]
    expect(valueStyle).toContain('overflow-wrap: anywhere')
    expect(valueStyle).not.toMatch(/ellipsis|white-space:\s*nowrap|overflow:\s*hidden/)
  })

  it('guards stale ledger views and unverified PDFs', () => {
    const page = readFileSync(
      new URL('../pages/LedgerPage.jsx', import.meta.url),
      'utf8',
    )

    expect(page).toContain('setLedgerVerified(false)')
    expect(page).toContain('setLedgerVerified(true)')
    expect(page).toContain('!ledgerVerified || pageError')
    expect(page).toContain('statementAccount.statementTotals?.canExport')
    expect(page).toContain('Could not generate statement PDF')
    expect(page).toContain("{ key: 'paidAmount', label: 'Last Payment Amount' }")
  })
})