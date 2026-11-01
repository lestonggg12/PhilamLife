import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ setPicker: vi.fn(), navigate: vi.fn() }))
vi.mock('react', async (original) => {
  const actual = await original()
  return { ...actual, useState: (initial) => [initial, state.setPicker] }
})
vi.mock('react-router-dom', () => ({ Link: 'a', useNavigate: () => state.navigate }))
vi.mock('../context/OrganizationContext', () => ({ useOrganization: () => ({ organization: { hoaName: 'Fixture HOA' } }) }))
import LandingPage from './LandingPage'
function find(node, label) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'button' && node.props.children === label) return node
  for (const child of React.Children.toArray(node.props?.children)) {
    const result = find(child, label)
    if (result) return result
  }
  return null
}
beforeEach(() => vi.clearAllMocks())
describe('Access Portal for an authenticated session', () => {
  it('delegates directly to the authenticated dashboard handler without opening the role picker', () => {
    const onAccessPortal = vi.fn()
    find(LandingPage({ onAccessPortal }), 'ACCESS PORTAL').props.onClick()
    expect(onAccessPortal).toHaveBeenCalledOnce()
    expect(state.setPicker).not.toHaveBeenCalled()
    expect(state.navigate).not.toHaveBeenCalled()
  })
  it('keeps the login role picker when the app has no authenticated session', () => {
    find(LandingPage(), 'ACCESS PORTAL').props.onClick()
    expect(state.setPicker).toHaveBeenCalledWith('login')
    expect(state.navigate).not.toHaveBeenCalled()
  })
  it('keeps Learn more using the guide role picker even while authenticated', () => {
    const onAccessPortal = vi.fn(), tree = LandingPage({ onAccessPortal })
    function guide(node) {
      if (!node || typeof node !== 'object') return null
      if (node.type === 'a' && node.props.children === 'Learn more →') return node
      return React.Children.toArray(node.props?.children).map(guide).find(Boolean)
    }
    guide(tree).props.onClick({ preventDefault: vi.fn() })
    expect(state.setPicker).toHaveBeenCalledWith('guide')
    expect(onAccessPortal).not.toHaveBeenCalled()
  })
})
