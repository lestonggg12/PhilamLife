import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const homeowners = readFileSync(resolve(here, '../pages/HomeownersPage.jsx'), 'utf8')

describe('Phase 1B classification integration safety gate', () => {
  it('mounts the panel only behind an explicit development-only flag', () => {
    expect(homeowners).toContain("import PropertyClassificationPanel from '../components/PropertyClassificationPanel'")
    expect(homeowners).toContain('import.meta.env.DEV &&')
    expect(homeowners).toContain("import.meta.env.VITE_ENABLE_PROPERTY_CLASSIFICATION === 'true'")
    expect(homeowners).toContain('<PropertyClassificationPanel')
  })

  it('passes the selected lot, actual role and refresh callback to the panel', () => {
    expect(homeowners).toContain('propertyId={selectedProperty.id}')
    expect(homeowners).toContain('userRole={userRole}')
    expect(homeowners).toContain('onChanged={() => loadHomeowners(true)}')
  })
})
