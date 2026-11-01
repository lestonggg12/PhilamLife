import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))
import ActivityLogPage, { activityDisplay } from './ActivityLogPage'

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
