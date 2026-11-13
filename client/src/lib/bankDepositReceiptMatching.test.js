import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

const historical = read(
  '../../../supabase/migrations/20261112112506_bank_deposit_receipt_matching.sql',
)

const retirement = read(
  '../../../supabase/migrations/20261113070156_disable_retired_bank_deposit_access.sql',
)

describe('Retired deposit receipt matching', () => {
  it('retains the historical matching migration', () => {
    expect(historical).toContain('bank_deposit_receipt_links')
    expect(historical).toContain('link_bank_deposit_receipt')
  })

  it('disables the old receipt matching API', () => {
    expect(retirement).toMatch(
      /REVOKE EXECUTE ON FUNCTION\s+public\.link_bank_deposit_receipt\(/i,
    )

    expect(retirement).toMatch(
      /REVOKE EXECUTE ON FUNCTION\s+public\.unlink_bank_deposit_receipt\(/i,
    )
  })
})
