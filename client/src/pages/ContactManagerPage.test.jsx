import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
vi.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), vi.fn()] }))
import ContactManagerPage from './ContactManagerPage'

describe('Contact Manager role presentation', () => {
  it.each(['admin', 'secretary', 'treasurer'])('uses accurate account labels and a neutral workspace for %s', (role) => {
    const html = renderToStaticMarkup(<ContactManagerPage user={{ id: 'fixture', role, is_active: true }} />)
    expect(html).toContain('Homeowner contacts')
    expect(html).not.toContain('Secretary workspace')
    expect(html).toContain('Active property accounts')
    expect(html).toContain('All property accounts')
    expect(html).toContain('Total Lot Accounts')
    expect(html).toContain('Lot accounts marked as moved')
    expect(html).toContain('Former accounts after a transfer')
    expect(html).not.toContain('No contacts match')
  })
})
