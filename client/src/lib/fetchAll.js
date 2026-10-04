/**
 * Pagination helpers for Supabase / PostgREST reads.
 *
 * WHY THIS EXISTS
 * Supabase's Data API returns at most `Max rows` rows per request (default
 * 1,000). A query that goes over that cap does NOT fail - it quietly returns
 * the first 1,000 rows, so totals, balances, overdue lists and exports come
 * out wrong with no error. Every query that reads a table which grows over
 * time (payments, charges, service transactions, expenses, ...) must go
 * through `fetchAll` so it keeps requesting pages until nothing is left.
 *
 * USAGE
 *   const { data, error } = await fetchAll(() =>
 *     supabase.from('payments').select('*').order('paid_at', { ascending: false }),
 *   )
 *
 * Pass a FUNCTION that builds a fresh query, not a query object: the Supabase
 * query builder is mutated by `.range()`, so each page needs its own builder.
 * The result has the same `{ data, error }` shape as a normal Supabase call, so
 * existing code that reads `result.data` / `result.error` keeps working.
 */

// Rows requested per page. Must be <= the project's "Max rows" API setting
// (Supabase default: 1000). Do not lower "Max rows" below this value.
export const PAGE_SIZE = 1000

// Safety valve against an endless loop (500 pages = 500,000 rows).
const MAX_PAGES = 500

/**
 * Fetch every row of a query, one page at a time.
 *
 * A stable tiebreaker order (`id` by default) is appended so that rows which
 * share the same sort value (e.g. two payments with an identical `paid_at`)
 * can never be repeated or skipped between pages.
 *
 * @param {() => object} buildQuery returns a fresh Supabase query builder
 * @param {{ pageSize?: number, tiebreaker?: string | null }} [options]
 * @returns {Promise<{ data: object[] | null, error: object | null }>}
 */
export async function fetchAll(
  buildQuery,
  { pageSize = PAGE_SIZE, tiebreaker = 'id' } = {},
) {
  const rows = []

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize

    let query = buildQuery()
    if (tiebreaker) query = query.order(tiebreaker, { ascending: true })

    const { data, error } = await query.range(from, from + pageSize - 1)

    if (error) return { data: null, error }

    const batch = data || []
    rows.push(...batch)

    // A short page means we reached the end.
    if (batch.length < pageSize) return { data: rows, error: null }
  }

  return {
    data: null,
    error: {
      message: `Stopped after ${MAX_PAGES * pageSize} rows; the query returned more data than expected.`,
    },
  }
}

/**
 * Fetch a whole table for an export/backup and PROVE it is complete.
 *
 * It first asks the database how many rows the table has, then downloads every
 * row, and returns an error if the two numbers differ. A backup that silently
 * misses rows is worse than no backup, so exports use this instead of a bare
 * `select('*')`.
 *
 * @param {object} client the Supabase client
 * @param {string} table table name
 * @returns {Promise<{ data: object[] | null, error: object | null, count: number }>}
 */
export async function fetchTableVerified(client, table) {
  const { count: expected, error: countError } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })

  if (countError) return { data: null, error: countError, count: 0 }

  const { data, error } = await fetchAll(() => client.from(table).select('*'))
  if (error) return { data: null, error, count: 0 }

  if (typeof expected === 'number' && data.length !== expected) {
    return {
      data: null,
      count: data.length,
      error: {
        message: `Export of "${table}" is incomplete: expected ${expected} rows but received ${data.length}. Nothing was downloaded; please try again.`,
      },
    }
  }

  return { data, error: null, count: data.length }
}
