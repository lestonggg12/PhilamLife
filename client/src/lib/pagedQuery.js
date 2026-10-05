/**
 * Helpers for pages that read one screenful (50 rows) at a time from the
 * database instead of downloading a whole table.
 *
 * Everything here is pure (no network), so it is unit-tested in pagedQuery.test.js.
 * All dates are Manila time. The Philippines has no daylight saving, so Manila
 * is always UTC+08:00 and a fixed "+08:00" offset is exact.
 */

export const PAGE_ROWS = 50

const MANILA_OFFSET = '+08:00'
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MAX_SEARCH_WORDS = 5

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** Today's month in Manila as 'YYYY-MM'. */
export function currentManilaMonthKey(now = new Date()) {
  // en-CA formats as YYYY-MM-DD, the same trick the rest of the app uses.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' })
    .format(now)
    .slice(0, 7)
}

/** 'YYYY-MM' moved forward/back by whole months. */
export function shiftMonthKey(monthKey, delta) {
  const [year, month] = monthKey.split('-').map(Number)
  const index = year * 12 + (month - 1) + delta
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`
}

/** 'YYYY-MM' -> 'October 2026'. */
export function monthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** 'YYYY-MM-DD' plus whole days, as 'YYYY-MM-DD' (pure calendar math, no timezone). */
export function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/** Timestamp range covering a whole Manila month: from inclusive, to exclusive. */
export function monthRange(monthKey) {
  return {
    from: `${monthKey}-01T00:00:00${MANILA_OFFSET}`,
    to: `${shiftMonthKey(monthKey, 1)}-01T00:00:00${MANILA_OFFSET}`,
  }
}

/** Timestamp range covering one Manila day. */
export function dayRange(dateKey) {
  return {
    from: `${dateKey}T00:00:00${MANILA_OFFSET}`,
    to: `${addDaysToDateKey(dateKey, 1)}T00:00:00${MANILA_OFFSET}`,
  }
}

/**
 * Range between two optional Manila dates (both inclusive). Either end may be
 * empty, which leaves that side open. Returns null when both are empty.
 */
export function dateSpanRange(fromKey, toKey) {
  if (!fromKey && !toKey) return null
  return {
    from: fromKey ? `${fromKey}T00:00:00${MANILA_OFFSET}` : null,
    to: toKey ? `${addDaysToDateKey(toKey, 1)}T00:00:00${MANILA_OFFSET}` : null,
  }
}

/** Row window for a 0-based page number, for Supabase's .range(from, to). */
export function pageWindow(page, size = PAGE_ROWS) {
  return { from: page * size, to: page * size + size - 1 }
}

export function pageCount(total, size = PAGE_ROWS) {
  return Math.max(1, Math.ceil((Number(total) || 0) / size))
}

/**
 * Split what the user typed into safe search words.
 *
 * Characters that have special meaning inside a PostgREST filter string
 * (comma, parentheses, quotes, backslash, % and *) are removed so they can never
 * break out of the filter. Every remaining word must match somewhere in the row.
 */
export function searchTokens(term, max = MAX_SEARCH_WORDS) {
  return String(term || '')
    .replace(/[,()"\\%*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
}

/** One word -> "column1 contains it OR column2 contains it ..." as a PostgREST or() string. */
export function ilikeAny(columns, token) {
  return columns.map((column) => `${column}.ilike."%${token}%"`).join(',')
}

/**
 * Add a multi-word search to a Supabase query. Each word must appear in at
 * least one of the columns (words are combined with AND, columns with OR), so
 * "juan block 3" finds Juan in Block 3 even though the words live in different columns.
 */
export function applySearch(query, columns, term) {
  return searchTokens(term).reduce(
    (current, token) => current.or(ilikeAny(columns, token)),
    query,
  )
}

/** Add an optional [from, to) timestamp window on a column. */
export function applyTimeRange(query, column, range) {
  if (!range) return query
  let next = query
  if (range.from) next = next.gte(column, range.from)
  if (range.to) next = next.lt(column, range.to)
  return next
}

/**
 * Turn a page of results into what the screen needs.
 *
 * Browsing (a month, a day, a date range) asks the database for an exact total.
 * An open-ended search does not: counting every matching row in a big table is
 * the slowest thing the page can ask for and nobody needs it. Instead the page
 * asks for ONE extra row; if it arrives there is a next page. The exact total is
 * then only known on the last page.
 *
 *   exact = true  -> `count` is the exact total.
 *   exact = false -> `data` holds up to size + 1 rows.
 *
 * Returns { rows, total, minimum }. `total` is null while more pages remain after
 * an uncounted search; `minimum` is how many rows are known to exist so far.
 */
export function interpretPage(data, count, page, exact, size = PAGE_ROWS) {
  const list = data || []

  if (exact) {
    const total = Number(count) || 0
    return { rows: list, total, minimum: total }
  }

  const hasMore = list.length > size
  const rows = hasMore ? list.slice(0, size) : list
  const minimum = page * size + rows.length

  return { rows, total: hasMore ? null : minimum, minimum }
}

/** "1,234 records", "1 record", or "50+ records" when the exact total is not known yet. */
export function countLabel({ total, minimum }, singular = 'record', plural = 'records') {
  const known = total !== null && total !== undefined
  const value = known ? total : minimum
  const word = known && value === 1 ? singular : plural
  return `${Number(value).toLocaleString('en-PH')}${known ? '' : '+'} ${word}`
}
