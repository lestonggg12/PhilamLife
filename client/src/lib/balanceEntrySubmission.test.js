import { expect, it, vi } from 'vitest'
import { submitBalanceEntry } from './balanceEntrySubmission'

const payload = {
  property_id: 32, category: 'Association Dues', amount: '200000.00',
  as_of_date: '2026-06-03', description: null,
}

function fixture(firstResult, lookupResult) {
  const lookup = { eq: vi.fn(() => lookup), maybeSingle: vi.fn().mockResolvedValue(lookupResult) }
  const table = {
    insert: vi.fn(() => ({ select: () => ({ single: async () => firstResult }) })),
    select: vi.fn(() => lookup),
  }
  return { from: () => table, table, lookup }
}

it('returns a confirmed insert without a recovery read', async () => {
  const db = fixture({ data: { id: 'entry' } })
  expect(await submitBalanceEntry(db, payload, 'staff', 'request')).toEqual({ id: 'entry' })
  expect(db.table.insert).toHaveBeenCalledWith({ ...payload, submission_id: 'request' })
  expect(db.table.select).not.toHaveBeenCalled()
})

it('recovers the original entry only when actor, lot and form values match', async () => {
  const original = { ...payload, id: 'entry', voided_at: null }
  const first = { error: { message: 'Duplicate submission' } }
  const db = fixture(first, { data: original })
  await expect(submitBalanceEntry(db, payload, 'staff', 'request')).resolves.toEqual(original)
  expect(db.lookup.eq.mock.calls).toEqual([
    ['submission_id', 'request'], ['property_id', 32], ['created_by', 'staff'],
  ])
  await expect(submitBalanceEntry(fixture(first, { data: { ...original, amount: '1' } }), payload, 'staff', 'request'))
    .rejects.toThrow('Duplicate submission')
  await expect(submitBalanceEntry(fixture(first, { data: { ...original, voided_at: '2026-11-09' } }), payload, 'staff', 'request'))
    .rejects.toThrow('later voided')
})
