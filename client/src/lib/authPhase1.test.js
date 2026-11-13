import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isActiveStaffProfile } from './profileRole'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('Phase 1 active staff access', () => {
  it.each(['admin', 'secretary', 'treasurer'])('accepts active %s', (role) => {
    expect(isActiveStaffProfile({ role: role.toUpperCase(), is_active: true })).toBe(true)
  })
  it.each([false, null, undefined, 0, 'true'])('rejects inactive/malformed flag %s', (value) => {
    expect(isActiveStaffProfile({ role: 'admin', is_active: value })).toBe(false)
  })
  it('rejects absent profiles and unsupported roles', () => {
    expect(isActiveStaffProfile(null)).toBe(false)
    expect(isActiveStaffProfile({ role: 'visitor', is_active: true })).toBe(false)
  })
  it('protects both login and session restoration', () => {
    expect(source('../pages/LoginPage.jsx')).toContain('if (!isActiveStaffProfile(profile))')
    expect(source('../App.jsx')).toContain('else if (!isActiveStaffProfile(profile))')
  })
})

describe('single authoritative inactivity controller', () => {
  it('uses SessionSecurity without Layout duplicate timers', () => {
    const app = source('../App.jsx')
    const layout = source('../components/Layout.jsx')
    const security = source('../components/SessionSecurity.jsx')
    expect(app).toContain('<SessionSecurity onExpired={handleLogout}>')
    expect(layout).not.toContain('useSessionTimeout')
    expect(layout).not.toContain('ActionDialog')
    expect(security).toContain("window.addEventListener('focus', expire)")
    expect(security).toContain("document.addEventListener('visibilitychange', expire)")
    expect(security).toContain('philam-idle-last-activity')
  })
})
