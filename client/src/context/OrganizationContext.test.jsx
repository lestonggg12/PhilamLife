import React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { query, client } = vi.hoisted(() => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() }
  return { query, client: { from: vi.fn(() => query) } }
})
vi.mock('../lib/supabaseClient', () => ({ supabase: client }))
import { OrganizationProvider, useOrganization } from './OrganizationContext'

function context(enabled = true) {
  let captured
  function Consumer() { captured = useOrganization(); return null }
  renderToString(<OrganizationProvider enabled={enabled}><Consumer /></OrganizationProvider>)
  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

const saved = { id: 1, hoa_name: 'Updated HOA', address: 'Updated address', date_format: 'DD/MM/YYYY', session_timeout: '15', require_strong_password: false }

describe('organization context refresh', () => {
  it('maps and caches confirmed settings without a second database request', async () => {
    expect(await context().refreshOrganization(saved)).toEqual({ error: null, cacheError: null })
    expect(client.from).not.toHaveBeenCalled()
    const [key, value] = localStorage.setItem.mock.calls[0]
    expect(key).toBe('philamlife_organization')
    expect(JSON.parse(value)).toMatchObject({ hoaName: 'Updated HOA', address: 'Updated address', dateFormat: 'DD/MM/YYYY', sessionTimeoutMinutes: 15, requireStrongPassword: false })
  })
  it('retains the existing no-argument database refresh', async () => {
    query.maybeSingle.mockResolvedValue({ data: saved, error: null })
    expect((await context().refreshOrganization()).error).toBeNull()
    expect(client.from).toHaveBeenCalledWith('system_settings')
    expect(query.eq).toHaveBeenCalledWith('id', 1)
    expect(JSON.parse(localStorage.setItem.mock.calls[0][1]).hoaName).toBe('Updated HOA')
  })
  it('reports browser cache restrictions separately', async () => {
    const error = new Error('Storage blocked')
    localStorage.setItem.mockImplementation(() => { throw error })
    expect(await context().refreshOrganization(saved)).toEqual({ error: null, cacheError: error })
  })
  it('does not replace cached values after a read error or missing row', async () => {
    const current = context()
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error('Denied') })
    expect((await current.refreshOrganization()).error.message).toBe('Denied')
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    expect((await current.refreshOrganization()).error.message).toBe('The settings row was not found')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
  it('returns transport errors rather than an unhandled rejection', async () => {
    query.maybeSingle.mockRejectedValue(new Error('Offline'))
    expect((await context().refreshOrganization()).error.message).toBe('Offline')
  })
  it('preserves the disabled-provider guard', async () => {
    expect((await context(false).refreshOrganization(saved)).error.message).toMatch(/session/)
    expect(client.from).not.toHaveBeenCalled()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
