import { describe, it, expect } from 'vitest'
import { fetchAll, fetchTableVerified, PAGE_SIZE } from './fetchAll'

const SERVER_MAX_ROWS = 1000 // Supabase default "Max rows"

/** A fake query builder that behaves like PostgREST, including the row cap. */
function fakeTable(rows, { failOnPage = null } = {}) {
  const calls = { requests: 0, orders: [] }

  function builder() {
    const state = { orders: [], from: null, to: null }
    const api = {
      select: () => api,
      order(column) {
        state.orders.push(column)
        return api
      },
      range(from, to) {
        state.from = from
        state.to = to
        return api
      },
      then(resolve, reject) {
        calls.requests += 1
        calls.orders.push([...state.orders])
        if (failOnPage !== null && calls.requests === failOnPage) {
          return Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve, reject)
        }
        const from = state.from ?? 0
        const requestedTo = state.to ?? from + SERVER_MAX_ROWS - 1
        const to = Math.min(requestedTo, from + SERVER_MAX_ROWS - 1) // server cap
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve, reject)
      },
    }
    return api
  }

  return { builder, calls }
}

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))

describe('the bug this fixes', () => {
  it('a plain query silently stops at 1000 rows', async () => {
    const { builder } = fakeTable(makeRows(2500))
    const { data, error } = await builder().select('*')
    expect(error).toBeNull()
    expect(data).toHaveLength(1000) // 1,500 rows silently missing
  })
})

describe('fetchAll', () => {
  it('returns every row when the table is larger than the API cap', async () => {
    const { builder, calls } = fakeTable(makeRows(2500))
    const { data, error } = await fetchAll(builder)
    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(data[0].id).toBe(1)
    expect(data[2499].id).toBe(2500)
    expect(calls.requests).toBe(3)
  })

  it('never repeats or skips a row across pages', async () => {
    const { builder } = fakeTable(makeRows(3333))
    const { data } = await fetchAll(builder)
    const ids = data.map((row) => row.id)
    expect(new Set(ids).size).toBe(3333)
  })

  it('uses a single request for a small table', async () => {
    const { builder, calls } = fakeTable(makeRows(150))
    const { data } = await fetchAll(builder)
    expect(data).toHaveLength(150)
    expect(calls.requests).toBe(1)
  })

  it('handles an empty table', async () => {
    const { builder } = fakeTable([])
    const { data, error } = await fetchAll(builder)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('handles a table of exactly one full page', async () => {
    const { builder } = fakeTable(makeRows(PAGE_SIZE))
    const { data, error } = await fetchAll(builder)
    expect(error).toBeNull()
    expect(data).toHaveLength(PAGE_SIZE)
  })

  it('appends a stable id tiebreaker after the caller\'s own ordering', async () => {
    const { builder, calls } = fakeTable(makeRows(10))
    await fetchAll(() => builder().order('paid_at'))
    expect(calls.orders[0]).toEqual(['paid_at', 'id'])
  })

  it('can skip the tiebreaker for tables without an id column', async () => {
    const { builder, calls } = fakeTable(makeRows(10))
    await fetchAll(builder, { tiebreaker: null })
    expect(calls.orders[0]).toEqual([])
  })

  it('returns the error (and no partial data) if any page fails', async () => {
    const { builder } = fakeTable(makeRows(2500), { failOnPage: 2 })
    const { data, error } = await fetchAll(builder)
    expect(data).toBeNull()
    expect(error.message).toBe('boom')
  })
})

describe('fetchTableVerified', () => {
  function fakeClient(rows, reportedCount = rows.length) {
    return {
      from: () => ({
        select: (_cols, options) => {
          if (options && options.head) {
            return Promise.resolve({ count: reportedCount, error: null })
          }
          return fakeTable(rows).builder()
        },
      }),
    }
  }

  it('returns all rows and the verified count', async () => {
    const result = await fetchTableVerified(fakeClient(makeRows(2200)), 'payments')
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(2200)
    expect(result.count).toBe(2200)
  })

  it('refuses to produce an export when the row counts disagree', async () => {
    const result = await fetchTableVerified(fakeClient(makeRows(2200), 2300), 'payments')
    expect(result.data).toBeNull()
    expect(result.error.message).toMatch(/incomplete: expected 2300 rows but received 2200/)
  })

  it('reports a count failure instead of exporting blindly', async () => {
    const client = {
      from: () => ({
        select: () => Promise.resolve({ count: null, error: { message: 'no access' } }),
      }),
    }
    const result = await fetchTableVerified(client, 'payments')
    expect(result.data).toBeNull()
    expect(result.error.message).toBe('no access')
  })
})
