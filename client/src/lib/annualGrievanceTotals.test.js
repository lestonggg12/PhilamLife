import { describe, expect, it } from 'vitest'
import { summarizeAnnualGrievances } from './annualReportData'

const monthRow = (index, started = true) => {
  const month = String(index + 1).padStart(2, '0')
  const last = new Date(Date.UTC(2026, index + 1, 0)).getUTCDate()
  return {
    from: '2026-' + month + '-01',
    to: started ? '2026-' + month + '-' + String(last).padStart(2, '0') : null,
    not_started: !started,
    opening: 2,
    received: 1,
    reopened: 0,
    resolved: 1,
    dismissed: 0,
    withdrawn: 0,
    closing: 2,
    over_30_days: 1,
  }
}

describe('Annual grievance summary', () => {
  it('combines twelve monthly summaries without adding opening and closing snapshots', () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      monthRow(index, index < 11))
    const result = summarizeAnnualGrievances(2026, rows)
    expect(result.opening).toBe(2)
    expect(result.received).toBe(11)
    expect(result.resolved).toBe(11)
    expect(result.closing).toBe(2)
    expect(result.over_30_days).toBe(1)
    expect(result.not_started).toBe(false)
    expect(result.to).toBe('2026-11-30')
  })

  it('rejects incomplete or wrongly ordered periods', () => {
    const rows = Array.from({ length: 12 }, (_, index) => monthRow(index))
    expect(() => summarizeAnnualGrievances(2026, rows.slice(0, 11))).toThrow()
    rows[3].from = '2026-01-01'
    expect(() => summarizeAnnualGrievances(2026, rows)).toThrow()
  })

  it('rejects missing or invalid counts', () => {
    const rows = Array.from({ length: 12 }, (_, index) => monthRow(index))
    rows[0].received = null
    expect(() => summarizeAnnualGrievances(2026, rows)).toThrow()
  })

  it('accepts a not-yet-started year without inventing activity', () => {
    const rows = Array.from({ length: 12 }, (_, index) => monthRow(index, false))
    const result = summarizeAnnualGrievances(2026, rows)
    expect(result.not_started).toBe(true)
    expect(result.received).toBe(0)
    expect(result.to).toBeNull()
  })
})
