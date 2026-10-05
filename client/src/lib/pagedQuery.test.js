import { describe, it, expect } from 'vitest'
import {
  PAGE_ROWS,
  addDaysToDateKey,
  applySearch,
  applyTimeRange,
  countLabel,
  currentManilaMonthKey,
  dateSpanRange,
  dayRange,
  ilikeAny,
  interpretPage,
  monthLabel,
  monthRange,
  pageCount,
  pageWindow,
  searchTokens,
  shiftMonthKey,
} from './pagedQuery'

describe('Manila month helpers', () => {
  it('uses the Manila calendar, not the computer clock', () => {
    // 17:00 UTC on 30 Sep is already 01:00 on 1 Oct in Manila.
    expect(currentManilaMonthKey(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10')
    // 15:59 UTC on 30 Sep is still 23:59 on 30 Sep in Manila.
    expect(currentManilaMonthKey(new Date('2026-09-30T15:59:00Z'))).toBe('2026-09')
  })

  it('moves between months across year boundaries', () => {
    expect(shiftMonthKey('2026-10', 1)).toBe('2026-11')
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-03', -15)).toBe('2024-12')
  })

  it('labels months for display', () => {
    expect(monthLabel('2026-10')).toBe('October 2026')
    expect(monthLabel('2027-01')).toBe('January 2027')
  })
})

describe('time ranges (always Manila +08:00, end exclusive)', () => {
  it('covers a whole month', () => {
    expect(monthRange('2026-10')).toEqual({
      from: '2026-10-01T00:00:00+08:00',
      to: '2026-11-01T00:00:00+08:00',
    })
    expect(monthRange('2026-12').to).toBe('2027-01-01T00:00:00+08:00')
  })

  it('covers a single day, including month and leap-year ends', () => {
    expect(dayRange('2026-10-04')).toEqual({
      from: '2026-10-04T00:00:00+08:00',
      to: '2026-10-05T00:00:00+08:00',
    })
    expect(dayRange('2026-10-31').to).toBe('2026-11-01T00:00:00+08:00')
    expect(dayRange('2028-02-28').to).toBe('2028-02-29T00:00:00+08:00')
    expect(dayRange('2028-02-29').to).toBe('2028-03-01T00:00:00+08:00')
  })

  it('treats the end date of a custom span as inclusive', () => {
    expect(dateSpanRange('2026-10-01', '2026-10-03')).toEqual({
      from: '2026-10-01T00:00:00+08:00',
      to: '2026-10-04T00:00:00+08:00',
    })
  })

  it('allows an open-ended custom span, and none at all', () => {
    expect(dateSpanRange('2026-10-01', '')).toEqual({ from: '2026-10-01T00:00:00+08:00', to: null })
    expect(dateSpanRange('', '2026-10-03')).toEqual({ from: null, to: '2026-10-04T00:00:00+08:00' })
    expect(dateSpanRange('', '')).toBeNull()
  })

  it('does simple date arithmetic', () => {
    expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('paging maths', () => {
  it('computes the row window for each page', () => {
    expect(PAGE_ROWS).toBe(50)
    expect(pageWindow(0)).toEqual({ from: 0, to: 49 })
    expect(pageWindow(1)).toEqual({ from: 50, to: 99 })
    expect(pageWindow(3, 25)).toEqual({ from: 75, to: 99 })
  })

  it('computes the number of pages (never fewer than one)', () => {
    expect(pageCount(0)).toBe(1)
    expect(pageCount(50)).toBe(1)
    expect(pageCount(51)).toBe(2)
    expect(pageCount(1234)).toBe(25)
    expect(pageCount(null)).toBe(1)
  })
})

describe('search words', () => {
  it('splits on spaces and drops empty words', () => {
    expect(searchTokens('  juan   dela cruz ')).toEqual(['juan', 'dela', 'cruz'])
    expect(searchTokens('')).toEqual([])
    expect(searchTokens(null)).toEqual([])
  })

  it('removes characters that could break out of a filter', () => {
    expect(searchTokens('a,b')).toEqual(['a', 'b'])
    expect(searchTokens('x),or=(id.gt.0')).toEqual(['x', 'or=', 'id.gt.0'])
    expect(searchTokens('say "hi"')).toEqual(['say', 'hi'])
    expect(searchTokens('50%')).toEqual(['50'])
    expect(searchTokens('back\\slash')).toEqual(['back', 'slash'])
    expect(searchTokens('wild*card')).toEqual(['wild', 'card'])
  })

  it('keeps ordinary receipt numbers, lots and apostrophes intact', () => {
    expect(searchTokens("OR-2026-000123")).toEqual(['OR-2026-000123'])
    expect(searchTokens("Dela Cruz-O'Brien 12-A")).toEqual(["Dela", "Cruz-O'Brien", '12-A'])
  })

  it('limits how many words are used', () => {
    expect(searchTokens('a b c d e f g')).toHaveLength(5)
  })

  it('never produces a word containing a filter-breaking character', () => {
    const nasty = 'a,b(c)d"e\\f%g*h'
    for (const token of searchTokens(nasty)) {
      expect(token).not.toMatch(/[,()"\\%*]/)
    }
  })
})

describe('ilikeAny', () => {
  it('matches the word in any of the columns, quoted', () => {
    expect(ilikeAny(['receipt_number', 'payer'], 'juan')).toBe(
      'receipt_number.ilike."%juan%",payer.ilike."%juan%"',
    )
  })
})

/** Records the filter calls made on it, like a Supabase query. */
function recorder() {
  const calls = []
  const query = {
    or: (value) => { calls.push(['or', value]); return query },
    gte: (column, value) => { calls.push(['gte', column, value]); return query },
    lt: (column, value) => { calls.push(['lt', column, value]); return query },
  }
  return { query, calls }
}

describe('applySearch', () => {
  it('adds one OR group per word so all words must match', () => {
    const { query, calls } = recorder()
    applySearch(query, ['payer', 'block_name'], 'juan block3')
    expect(calls).toEqual([
      ['or', 'payer.ilike."%juan%",block_name.ilike."%juan%"'],
      ['or', 'payer.ilike."%block3%",block_name.ilike."%block3%"'],
    ])
  })

  it('adds nothing for an empty search', () => {
    const { query, calls } = recorder()
    applySearch(query, ['payer'], '   ')
    expect(calls).toEqual([])
  })
})

describe('applyTimeRange', () => {
  it('adds both ends of a range', () => {
    const { query, calls } = recorder()
    applyTimeRange(query, 'paid_at', monthRange('2026-10'))
    expect(calls).toEqual([
      ['gte', 'paid_at', '2026-10-01T00:00:00+08:00'],
      ['lt', 'paid_at', '2026-11-01T00:00:00+08:00'],
    ])
  })

  it('skips an open end and a missing range', () => {
    const open = recorder()
    applyTimeRange(open.query, 'paid_at', { from: '2026-10-01T00:00:00+08:00', to: null })
    expect(open.calls).toEqual([['gte', 'paid_at', '2026-10-01T00:00:00+08:00']])

    const none = recorder()
    applyTimeRange(none.query, 'paid_at', null)
    expect(none.calls).toEqual([])
  })
})

describe('interpretPage', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i }))

  it('uses the exact count when browsing', () => {
    expect(interpretPage(rows(50), 2876, 3, true)).toEqual({ rows: rows(50), total: 2876, minimum: 2876 })
    expect(interpretPage(null, null, 0, true)).toEqual({ rows: [], total: 0, minimum: 0 })
  })

  it('on an uncounted search, one extra row means there is a next page', () => {
    const result = interpretPage(rows(51), null, 0, false)
    expect(result.rows).toHaveLength(50)
    expect(result.total).toBeNull()
    expect(result.minimum).toBe(50)
  })

  it('on an uncounted search, a short page is the last page and reveals the exact total', () => {
    const result = interpretPage(rows(17), null, 2, false)
    expect(result.rows).toHaveLength(17)
    expect(result.total).toBe(117) // two full pages of 50 + 17
    expect(result.minimum).toBe(117)
  })

  it('treats exactly one full page with nothing after it as complete', () => {
    const result = interpretPage(rows(50), null, 0, false)
    expect(result.rows).toHaveLength(50)
    expect(result.total).toBe(50)
  })

  it('handles a search with no results', () => {
    expect(interpretPage([], null, 0, false)).toEqual({ rows: [], total: 0, minimum: 0 })
  })

  it('never returns more than one page of rows', () => {
    expect(interpretPage(rows(80), null, 0, false).rows).toHaveLength(50)
  })
})

describe('countLabel', () => {
  it('labels exact totals, singular and plural', () => {
    expect(countLabel({ total: 0, minimum: 0 })).toBe('0 records')
    expect(countLabel({ total: 1, minimum: 1 })).toBe('1 record')
    expect(countLabel({ total: 2876, minimum: 2876 })).toBe('2,876 records')
    expect(countLabel({ total: 3, minimum: 3 }, 'receipt', 'receipts')).toBe('3 receipts')
  })

  it('shows a plus sign while the total is not known', () => {
    expect(countLabel({ total: null, minimum: 50 })).toBe('50+ records')
    expect(countLabel({ total: null, minimum: 150 }, 'receipt', 'receipts')).toBe('150+ receipts')
  })
})
