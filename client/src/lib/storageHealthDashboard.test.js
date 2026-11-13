import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8')

const migration = read(
  '../../../supabase/migrations/20261113162000_admin_storage_health.sql',
)
const settings = read('../pages/SystemSettingsPage.jsx')
const component = read('../components/StorageHealthDashboard.jsx')

describe('Admin storage and system health', () => {
  it('places the dashboard in System Settings', () => {
    expect(settings).toContain("['health', 'Storage & Health']")
    expect(settings).toContain(
      "activeTab === 'health' && <StorageHealthDashboard />",
    )
  })

  it('requires Admin authorization on the server', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain('auth.uid() IS NULL')
    expect(migration).toContain("IS DISTINCT FROM 'admin'")
    expect(migration).toContain('FROM PUBLIC, anon')
    expect(migration).toContain('TO authenticated')
  })

  it('returns read-only metrics without destructive operations', () => {
    expect(migration).toContain('pg_database_size')
    expect(migration).toContain('storage.objects')
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\bTRUNCATE\b/i)
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/i)
    expect(component).toContain("supabase.rpc('admin_storage_health')")
    expect(component).not.toContain('set_activity_archive_enabled')
  })
})