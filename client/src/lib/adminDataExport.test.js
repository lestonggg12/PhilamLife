import { describe, expect, it } from 'vitest'
import { ADMIN_EXPORT_TABLES, buildAdminDataExport } from './adminDataExport'

function fakeClient({ rows = {}, failTable, countDifference = 0, rejectTable } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const state = { head: false, from: 0, to: 999 }
      calls.push({ table, state })
      const query = {
        select(_columns, options = {}) { state.head = Boolean(options.head); return query },
        order(column) { state.order = column; return query },
        range(from, to) { state.from = from; state.to = to; return query },
        then(resolve, reject) {
          if (table === rejectTable) return Promise.reject(new Error('Network unavailable')).then(resolve, reject)
          if (table === 'late_penalty_year_rates' && !state.head && state.order !== 'year') return Promise.resolve({ data: null, error: { message: 'column id does not exist' } }).then(resolve, reject)
          if (table === failTable) return Promise.resolve({ data: null, error: { message: 'Permission denied' } }).then(resolve, reject)
          const data = rows[table] || []
          const result = state.head
            ? { data: null, count: data.length + (table === 'payments' ? countDifference : 0), error: null }
            : { data: data.slice(state.from, Math.min(state.to + 1, state.from + 1000)), error: null }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return query
    },
  }
}

describe('Admin application data export', () => {
  it('includes all six previously omitted financial/identity record groups', async () => {
    const omitted = ['balance_entries', 'homeowners', 'homeowner_balance_transfers', 'late_payment_penalties', 'late_penalty_year_rates', 'receipt_paper_numbers']
    const rows = Object.fromEntries(omitted.map((name) => [name, [{ id: `${name}-fixture`, original: 3000 }]]))
    const client = fakeClient({ rows })
    const payload = await buildAdminDataExport(client, { exportedBy: 'Admin fixture', exportedAt: '2026-11-01T06:00:00Z' })
    for (const name of omitted) {
      expect(payload.tables[name]).toEqual(rows[name])
      expect(payload.export_scope.row_counts[name]).toBe(1)
    }
    expect(Object.keys(payload.tables)).toHaveLength(30)
    expect(payload).toMatchObject({ exported_by: 'Admin fixture', exported_at: '2026-11-01T06:00:00Z', timezone: 'Asia/Manila' })
  })

  it('downloads beyond the API row cap and verifies counts for every table', async () => {
    const homeowners = Array.from({ length: 2501 }, (_, index) => ({ id: index + 1 }))
    const client = fakeClient({ rows: { homeowners } })
    const payload = await buildAdminDataExport(client)
    expect(payload.tables.homeowners).toEqual(homeowners)
    expect(payload.export_scope.row_counts.homeowners).toBe(2501)
    expect(client.calls.filter(({ table, state }) => table === 'homeowners' && !state.head)).toHaveLength(3)
    for (const table of ADMIN_EXPORT_TABLES) expect(client.calls.some((call) => call.table === table && call.state.head)).toBe(true)
  })

  it('uses the real year primary key for penalty rates without an id column', async () => {
    const rates = [{ year: 2025, rate: 0.015 }, { year: 2026, rate: 0.015 }]
    const client = fakeClient({ rows: { late_penalty_year_rates: rates } })
    const payload = await buildAdminDataExport(client)
    expect(payload.tables.late_penalty_year_rates).toEqual(rates)
    const reads = client.calls.filter(({ table, state }) => table === 'late_penalty_year_rates' && !state.head)
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every(({ state }) => state.order === 'year')).toBe(true)
  })

  it('does not return a partial payload when a newly included table is denied', async () => {
    await expect(buildAdminDataExport(fakeClient({ failTable: 'balance_entries' }))).rejects.toThrow('Unable to export balance_entries: Permission denied')
  })

  it('rejects a count mismatch instead of reporting a complete export', async () => {
    await expect(buildAdminDataExport(fakeClient({ rows: { payments: [{ id: 1 }] }, countDifference: 1 }))).rejects.toThrow('incomplete: expected 2 rows but received 1')
  })

  it('excludes confidential records and discloses server backup limitations', async () => {
    const client = fakeClient()
    const payload = await buildAdminDataExport(client)
    expect(payload.export_scope.excluded_tables).toEqual(['grievance_cases', 'grievance_events'])
    expect(client.calls.some(({ table }) => /grievance|auth\.|storage\./.test(table))).toBe(false)
    expect(payload.export_scope.excluded_components.join(' ')).toContain('Storage file contents')
    expect(payload.export_scope.consistency).toContain('not a single transactional snapshot')
    expect(payload.export_scope.table_count).toBe(Object.keys(payload.tables).length)
    expect(new Set(ADMIN_EXPORT_TABLES).size).toBe(ADMIN_EXPORT_TABLES.length)
  })

  it('surfaces transport failures and preserves legitimate empty tables', async () => {
    await expect(buildAdminDataExport(fakeClient({ rejectTable: 'homeowners' }))).rejects.toThrow('Network unavailable')
    const payload = await buildAdminDataExport(fakeClient())
    expect(payload.tables.homeowners).toEqual([])
    expect(payload.export_scope.row_counts.homeowners).toBe(0)
  })
})
