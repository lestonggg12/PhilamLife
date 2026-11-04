import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import ActivityLogPage, { activityDisplay, matchesActivitySearch } from './ActivityLogPage'

const actor = { user: 'Philam Admin' }
describe('Activity Log presentation', () => {
  it('separates a known payment format without changing the stored description', () => {
    const target = 'OR-2026-000016 — Sofia Santos — ₱20,000.00'
    const log = { ...actor, action: 'Payment Recorded', target }
    expect(activityDisplay(log)).toMatchObject({ subject: 'OR-2026-000016', detail: 'Sofia Santos', amount: 20000, status: '' })
    expect(log.target).toBe(target)
  })
  it('preserves unknown formats and malformed known formats verbatim', () => {
    for (const log of [
      { action: 'Grievance Updated', target: 'GR-2 — Complaint — Resolved' },
      { action: 'Payment Recorded', target: 'Receipt — Payer — pending' },
      { action: 'Payment Recorded', target: 'Receipt — Payer — ₱20.00 — additional text' },
    ]) expect(activityDisplay({ ...actor, ...log })).toMatchObject({ subject: log.target, detail: '' })
  })
  it('removes only the exact actor suffix and avoids repeating a document filename', () => {
    expect(activityDisplay({ ...actor, action: 'Document Deleted', target: 'Minutes — Minutes.pdf (by Philam Admin)' })).toMatchObject({ subject: 'Minutes', detail: '', status: 'warning' })
    expect(activityDisplay({ ...actor, action: 'Document Deleted', target: 'Minutes — Minutes.pdf (by Another Admin)' }).text).toContain('(by Another Admin)')
  })
  it('marks only destructive or failed events and prioritizes failure', () => {
    expect(activityDisplay({ action: 'Document Delete Failed' }).status).toBe('failed')
    expect(activityDisplay({ action: 'Payment Voided' }).status).toBe('warning')
    for (const action of ['Grievance Updated', 'Payment Recorded', 'Data Exported']) expect(activityDisplay({ action }).status).toBe('')
  })
  it('prefers structured subject and amount, and falls back for missing records', () => {
    expect(activityDisplay({ subject: 'Structured subject', amount: 100, target: 'Raw ₱50.00' })).toMatchObject({ subject: 'Structured subject', amount: 100 })
    expect(activityDisplay({})).toMatchObject({ subject: 'Unknown record', amount: null })
  })
  it('uses readable labels for settings field names', () => {
    expect(activityDisplay({ action: 'Settings Updated', target: 'price_per_sqm: 7.00 → 4.00' }).subject)
      .toBe('Price per square meter: 7.00 → 4.00')
  })
  it('renders six loading rows, labeled controls, and no status column', () => {
    const html = renderToStaticMarkup(<ActivityLogPage />)
    expect(html.match(/class="al-skeleton"/g)).toHaveLength(6)
    expect(html).toContain('Search activity')
    expect(html).toContain('Action type')
    expect(html).toContain('aria-controls="activity-filters"')
    expect(html).not.toContain('>Status<')
  })
})

describe('Treasurer service receipt activity', () => {
  it('displays a service receipt number and service details', () => {
    const target = 'SR-2026-000001 — Basketball Court for Sample Homeowner'
    expect(activityDisplay({
      action: 'Service Payment Recorded',
      target,
    })).toMatchObject({
      subject: 'SR-2026-000001',
      detail: 'Basketball Court · Sample Homeowner',
      amount: null,
      raw: target,
    })
  })

  it('shows balance collections with their original receipt', () => {
    expect(activityDisplay({
      action: 'Service Balance Collected',
      target: 'SR-2026-000002 — ₱50.00 for SR-2026-000001 — Sample Homeowner',
    })).toMatchObject({
      subject: 'SR-2026-000002',
      detail: 'Balance payment for SR-2026-000001 · Sample Homeowner',
      amount: 50,
    })
  })

  it('displays a voided receipt with the cancellation reason', () => {
    expect(activityDisplay({
      action: 'Service Receipt Voided',
      target: 'SR-2026-000003 — Function Hall for Sample Homeowner — ₱300.00 — Duplicate receipt',
    })).toMatchObject({
      subject: 'SR-2026-000003',
      detail: 'Function Hall · Sample Homeowner · Reason: Duplicate receipt',
      amount: 300,
      status: 'warning',
    })
  })

  it('preserves unknown service formats without guessing values', () => {
    const target = 'Legacy service entry'
    expect(activityDisplay({
      action: 'Service Payment Recorded',
      target,
    })).toMatchObject({
      subject: target,
      raw: target,
      amount: null,
    })
  })
})

describe('Activity Log audit regressions', () => {
  it('preserves document identifiers and exact source text', () => {
    const raw = 'board_minutes_2026 — board_minutes_2026.pdf (by Philam Admin)'
    expect(activityDisplay({ ...actor, action: 'Document Uploaded', target: raw })).toMatchObject({ raw, subject: 'board_minutes_2026', text: 'board_minutes_2026 — board_minutes_2026.pdf' })
  })
  it('does not rewrite unknown formats or values inside settings descriptions', () => {
    expect(activityDisplay({ action: 'Unknown', target: 'original_file: some_value' }).text).toBe('original_file: some_value')
    expect(activityDisplay({ action: 'Settings Updated', target: 'hoa_name: old_name → new_name; price_per_sqm: 5 → 6' }).text).toBe('Hoa Name: old_name → new_name; Price per square meter: 5 → 6')
  })
  it.each(['Block Removed','Homeowner Removed','Service Removed','Expense Voided','Event Deleted'])('marks %s as destructive', (action) => {
    expect(activityDisplay({ action }).status).toBe('warning')
  })
  it('keeps genuine expense descriptions that include peso amounts', () => {
    const target = 'Office Supplies — ₱500.00 (Fixture Treasurer) [Expense: fixture-id] — Reimbursed ₱500 for paper'
    for (const action of ['Expense Recorded','Expense Voided']) expect(activityDisplay({ action, target })).toMatchObject({ subject: 'Office Supplies', amount: 500, detail: 'Reimbursed ₱500 for paper', raw: target })
  })
  it.each(['price_per_sqm','Price per square meter','ADMIN','settings updated'])('matches original and displayed activity text: %s', (term) => {
    expect(matchesActivitySearch({ user: 'Admin', action: 'Settings Updated', target: 'price_per_sqm: 5 → 6' }, term)).toBe(true)
  })
  it('does not match unrelated terms, and treats blank searches as unfiltered', () => {
    expect(matchesActivitySearch({ target: 'Original text' }, 'missing')).toBe(false)
    expect(matchesActivitySearch({}, '  ')).toBe(true)
  })
  it('does not misparse a non-grievance description as a grievance', () => {
    expect(activityDisplay({ action: 'Other', target: 'GR-1 - Original - Text' }).subject).toBe('GR-1 - Original - Text')
  })
})
