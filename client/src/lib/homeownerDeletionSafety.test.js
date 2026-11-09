import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync(new URL('../pages/HomeownersPage.jsx', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('../../../supabase/migrations/20261109100000_guard_property_deletion_and_settings_concurrency.sql', import.meta.url),
  'utf8',
)

describe('homeowner deletion history safety', () => {
  it('does not make a browser-side payments-and-charges-only deletion decision', () => {
    const deletion = page.slice(page.indexOf('async function handleDeleteHomeowner'), page.indexOf('async function loadHomeowners'))
    expect(deletion).not.toContain("from('payments')")
    expect(deletion).not.toContain("from('property_charges')")
    expect(deletion).toContain('server confirms that it has no financial or operational history')
  })

  it('uses a locked database guard over every property foreign key', () => {
    expect(migration).toContain('create or replace function public.delete_empty_property_guarded')
    expect(migration).toContain("confrelid = 'public.properties'::regclass")
    expect(migration).toContain('for update')
    expect(migration).toContain('Historical records exist in')
    expect(migration).toContain('drop policy if exists "Admin and Secretary can delete properties" on public.properties')
  })
})