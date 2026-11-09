import React from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import EventCalendarPage from './EventCalendarPage'

describe('Calendar role presentation', () => {
  it('renders event management controls only for authorized roles', () => {
    const source = readFileSync(
      new URL('./EventCalendarPage.jsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain("const canManageEvents = role === 'secretary'")
    expect(source).toMatch(
      /\{canManageEvents && \(\s*<div className="cal-row-actions">/,
    )
  })
  it('offers scheduling to Secretary', () => {
    const html = renderToStaticMarkup(<EventCalendarPage user={{ id: 'fixture', role: 'secretary', is_active: true }} />)
    expect(html).toContain('Secretary workspace')
    expect(html).toContain('Schedule Event')
  })
  it.each(['admin','treasurer'])('shows %s a view-only calendar', (role) => {
    const html = renderToStaticMarkup(<EventCalendarPage user={{ id: 'fixture', role, is_active: true }} />)
    expect(html).toContain('Community calendar')
    expect(html).not.toContain('Schedule Event')
  })
  it('does not offer scheduling to an inactive Secretary', () => {
    expect(renderToStaticMarkup(<EventCalendarPage user={{ id: 'fixture', role: 'secretary', is_active: false }} />)).not.toContain('Schedule Event')
  })
  it('requires a verified active Secretary before showing management controls', () => {
    expect(renderToStaticMarkup(<EventCalendarPage user={{ id: 'fixture', role: 'secretary' }} />)).not.toContain('Schedule Event')
  })
})
