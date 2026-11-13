import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../../supabase/migrations/20261113155000_activity_archive_12_month_retention.sql',
    import.meta.url,
  ),
  'utf8',
)

const panel = readFileSync(
  new URL('../components/ActivityArchiveStatus.jsx', import.meta.url),
  'utf8',
)

describe('12-month activity archive retention', () => {
  it('keeps 12 complete calendar months in the live database', () => {
    expect(migration).toContain("date_trunc('month'")
    expect(migration).toContain("interval '12 months'")
    expect(migration).toContain("AT TIME ZONE 'Asia/Manila'")
  })

  it('keeps automatic archiving separate from notifications', () => {
    expect(migration).not.toMatch(/DELETE\s+FROM/i)
    expect(migration).not.toMatch(/TRUNCATE/i)
    expect(migration).not.toMatch(/prune_notifications/i)
    expect(migration).not.toMatch(/notification_expiry/i)
  })

  it('updates the archive retention explanation', () => {
    expect(panel).toContain('previous 12 complete months')
  })
})