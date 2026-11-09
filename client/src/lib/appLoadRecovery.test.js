import { describe, expect, it, vi } from 'vitest'
import { recoverPreloadError } from './appLoadRecovery'
import vercel from '../../vercel.json'

function browser() {
  const storage = new Map()
  return {
    navigator: { onLine: true },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: { reload: vi.fn() },
  }
}

describe('failed lazy page recovery', () => {
  it('reloads once per entry bundle and allows recovery in a later build', () => {
    const tab = browser()
    expect(recoverPreloadError(tab, '/assets/index-old.js')).toBe(true)
    expect(recoverPreloadError(tab, '/assets/index-old.js')).toBe(false)
    expect(recoverPreloadError(tab, '/assets/index-new.js')).toBe(true)
    expect(tab.location.reload).toHaveBeenCalledTimes(2)
  })

  it('leaves manual recovery available offline or when storage is denied', () => {
    const tab = browser()
    tab.navigator.onLine = false
    expect(recoverPreloadError(tab, '/assets/index-old.js')).toBe(false)
    tab.navigator.onLine = true
    Object.defineProperty(tab, 'sessionStorage', { get() { throw new Error('Denied') } })
    expect(recoverPreloadError(tab, '/assets/index-old.js')).toBe(false)
    expect(tab.location.reload).not.toHaveBeenCalled()
  })

  it('rewrites app paths and excludes asset, worker and API requests', () => {
    const rule = vercel.rewrites.find(rewrite => rewrite.destination === '/index.html')
    const matches = new RegExp(`^${rule.source}$`)
    for (const path of ['/', '/homeowners', '/homeowners/42', '/treasurer/reports', '/reset-password']) {
      expect(matches.test(path), path).toBe(true)
    }
    for (const path of ['/assets/missing.js', '/assets/missing', '/assets', '/sw.js',
      '/manifest.webmanifest', '/icons/missing.png', '/api/health']) {
      expect(matches.test(path), path).toBe(false)
    }
  })
})
