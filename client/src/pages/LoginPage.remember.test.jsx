import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ query: '' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useSearchParams: () => [new URLSearchParams(state.query), vi.fn()] }))
vi.mock('@marsidev/react-turnstile', () => ({ Turnstile: () => null }))
vi.mock('../lib/supabaseClient', () => ({ supabase: {}, setRememberMePreference: vi.fn(), clearRememberMePreference: vi.fn() }))
vi.mock('../context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { hoaName: 'Fixture HOA' } }) }))
import LoginPage from './LoginPage'
beforeEach(() => { state.query = '' })

describe('remembered-device login explanation', () => {
  it('shows the seven-weekday limit and associates the explanation with the checkbox', () => {
    const html = renderToStaticMarkup(<LoginPage onAuthenticated={() => {}} />)
    expect(html).toContain('aria-describedby="remember-device-policy"')
    expect(html).toContain('id="remember-device-policy"')
    expect(html).toContain('7 working days (Monday–Friday)')
    expect(html).toContain('After that, enter your credentials to sign in again.')
    expect(html).toContain('Idle timeout and manual sign-out still apply.')
  })
  it('shows a sign-in-again message after remembered-device expiration', () => {
    state.query = 'reason=remembered-expired'
    const html = renderToStaticMarkup(<LoginPage onAuthenticated={() => {}} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('Your remembered sign-in has expired. Enter your credentials to sign in again.')
  })
  it('does not show a false expiration message on an ordinary sign-in', () => {
    expect(renderToStaticMarkup(<LoginPage onAuthenticated={() => {}} />)).not.toContain('Your remembered sign-in has expired.')
  })
})
