import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const homeowners = readFileSync(resolve(here, '../pages/HomeownersPage.jsx'), 'utf8')

describe('Production classification integration', () => {
  it('offers verified classification for active lots to Admin and Secretary', () => {
    expect(homeowners).toContain("import PropertyClassificationPanel from '../components/PropertyClassificationPanel'")
    expect(homeowners).toContain("const canManageBlocks = userRole === 'admin' || userRole === 'secretary'")
    expect(homeowners).toContain('{!formerAccount && canManageBlocks && (')
    expect(homeowners).not.toContain('VITE_ENABLE_PROPERTY_CLASSIFICATION')
    expect(homeowners).toContain('<PropertyClassificationPanel')
  })

  it('passes the selected lot, actual role and refresh callback to the panel', () => {
    expect(homeowners).toContain('propertyId={selectedProperty.id}')
    expect(homeowners).toContain('userRole={userRole}')
    expect(homeowners).toContain('onChanged={() => loadHomeowners(true)}')
  })
})
