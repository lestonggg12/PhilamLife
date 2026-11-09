import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../pages/SystemSettingsPage.jsx', import.meta.url), 'utf8')
const helper = readFileSync(new URL('./saveSystemSettings.js', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('../../../supabase/migrations/20261109100000_guard_property_deletion_and_settings_concurrency.sql', import.meta.url),
  'utf8',
)

describe('system settings stale-save protection', () => {
  it('saves through a revision-checked RPC rather than a direct singleton update', () => {
    expect(helper).toContain("client.rpc('save_system_settings_guarded'")
    expect(helper).toContain('p_expected_revision: expectedRevision')
    expect(helper).not.toContain("from('system_settings')")
  })

  it('retains the draft and tells the Admin to reload after a concurrent save', () => {
    expect(page).toContain('Settings changed in another session')
    expect(page).toContain('setLoadedRevision(Number(saved.settings_revision))')
  })

  it('installs an atomic server-side revision guard', () => {
    expect(migration).toContain('add column if not exists settings_revision bigint not null default 1')
    expect(migration).toContain('create or replace function public.save_system_settings_guarded(')
    expect(migration).toContain("errcode = '40001'")
    expect(migration).toContain('Settings changed since this page was loaded. Refresh System Settings before saving.')
    expect(migration).toContain('drop policy if exists "Admin can update system settings" on public.system_settings')
  })
})