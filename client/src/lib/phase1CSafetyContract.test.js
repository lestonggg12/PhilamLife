import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(resolve(here, '../../../docs/phase1/PHASE1C_ISOLATED_TEST_ONLY_atomic_classification_and_penalty_guard.sql'), 'utf8')

describe('Phase 1C guarded SQL source contract', () => {
  it('keeps classification and penalty guard in one transaction', () => {
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;/)
    expect((sql.match(/\bCOMMIT;/g) || []).length).toBe(1)
    expect(sql).toContain('phase1c_financial_before')
    expect(sql).toContain('phase1c_verify')
  })
  it('requires exact penalty function baseline before patching', () => {
    expect(sql).toContain('Penalty posting function differs from reviewed baseline')
    expect(sql).toContain("property_classification <> ''unclassified''")
    expect(sql).toContain('EXECUTE replace(v_definition,v_old,v_new)')
  })
  it('does not insert, update or delete financial records directly', () => {
    const statements = sql.replace(/--[^\n]*/g, '')
    for (const name of ['payments','payment_allocations','late_payment_penalties','annual_penalty_assessments','property_charges','account_adjustments']) {
      expect(statements).not.toMatch(new RegExp(`(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO|TRUNCATE)\\s+(?:public\\.)?${name}\\b`, 'i'))
    }
  })
})
