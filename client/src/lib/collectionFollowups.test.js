import { expect, it, vi } from 'vitest'
import { countCollectionFollowups, followupRequest, saveCollectionFollowup } from './collectionFollowups'

it('counts across the whole filtered list in chunks and rejects unavailable counts', async () => {
  const count = vi.fn().mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 })
  const select = vi.fn(() => ({ in: count }))
  const client = { from: () => ({ select }) }
  const ids = Array.from({ length: 125 }, (_, i) => i + 1)
  await expect(countCollectionFollowups(client, ids)).resolves.toBe(3)
  expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
  expect(count.mock.calls.map(([column, batch]) => [column, batch.length])).toEqual([['property_id', 100], ['property_id', 25]])
  await expect(countCollectionFollowups(client, [])).resolves.toBe(0)
  count.mockResolvedValue({ count: null })
  await expect(countCollectionFollowups(client, [1])).rejects.toThrow('unavailable')
})

const payload = { property_id: 32, created_by: 'actor', action_type: 'Phone Call', details: 'Left a message', document_reference: null }
const stored = { ...payload, id: 'request-id', property_id: '32' }
function fixture(lookupRow, insertError) {
  const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.reject(insertError) }) }))
  const lookup = { eq: vi.fn(() => lookup), maybeSingle: async () => ({ data: lookupRow }) }
  return { from: () => ({ insert, select: () => lookup }), insert, lookup }
}

it('recovers a committed follow-up after the response is lost', async () => {
  const db = fixture(stored, new Error('Connection lost'))
  await expect(saveCollectionFollowup(db, payload, 'request-id')).resolves.toEqual(stored)
  expect(db.insert).toHaveBeenCalledWith({ ...payload, id: 'request-id' })
  expect(db.lookup.eq.mock.calls).toEqual([['id', 'request-id'], ['created_by', 'actor']])
})

it('fails when the recovered record does not match the submitted intent', async () => {
  const db = fixture({ ...stored, details: 'Another note' }, new Error('Duplicate ID'))
  await expect(saveCollectionFollowup(db, payload, 'request-id')).rejects.toThrow('Duplicate ID')
})

it('reuses a retry ID until confirmation, then allows a deliberate new action', async () => {
  const pending = new Map()
  const request = await followupRequest(payload, pending)
  expect((await followupRequest(payload, pending)).id).toBe(request.id)
  request.clear()
  expect((await followupRequest(payload, pending)).id).not.toBe(request.id)
})
