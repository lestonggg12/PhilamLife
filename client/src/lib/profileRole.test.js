import { describe, expect, it } from 'vitest'
import { normalizeProfileRole, normalizeRole } from './profileRole'

describe('profile role boundary', () => {
  it.each(['admin', 'secretary', 'treasurer'])('normalizes database-valid case variants for %s', (role) => {
    expect(normalizeRole(`  ${role.toUpperCase()}  `)).toBe(role)
  })
  it('preserves the original profile and inactive flag', () => {
    const profile = Object.freeze({ id: 'fixture', role: 'SECRETARY', is_active: false, full_name: 'Fixture' })
    expect(normalizeProfileRole(profile)).toEqual({ ...profile, role: 'secretary' })
    expect(profile.role).toBe('SECRETARY')
  })
  it('does not promote missing or unknown roles', () => {
    expect(normalizeRole(null)).toBe('')
    expect(normalizeRole({ role: 'admin' })).toBe('')
    expect(normalizeRole('visitor')).toBe('visitor')
    expect(normalizeProfileRole(null)).toBeNull()
  })
})
