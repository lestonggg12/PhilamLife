import { describe, expect, it, vi } from 'vitest'
import { updateHomeowner, removeHomeowner } from './homeownerWrites'
function client(result) {
  const query = { eq: vi.fn(() => query), select: vi.fn(() => query), single: vi.fn().mockResolvedValue(result) }
  const table = { update: vi.fn(() => query), delete: vi.fn(() => query) }
  return { from: vi.fn(() => table), table, query }
}
describe('confirmed homeowner writes', () => {
  it.each([['update', updateHomeowner], ['delete', removeHomeowner]])('%s confirms the affected row', async (action, write) => {
    const c = client({ data: { id: 42 }, error: null })
    expect(await write(c, 42, { homeowner_name: 'Updated owner' })).toEqual({ id: 42 })
    expect(c.from).toHaveBeenCalledWith('properties')
    expect(c.table[action]).toHaveBeenCalledOnce()
    expect(c.query.eq).toHaveBeenCalledWith('id', 42)
    expect(c.query.select).toHaveBeenCalledWith('id')
    expect(c.query.single).toHaveBeenCalledOnce()
  })
  it.each([updateHomeowner, removeHomeowner])('rejects an RLS no-op instead of confirming success', async (write) => {
    await expect(write(client({ data: null, error: null }), 42, {})).rejects.toThrow('No homeowner was')
  })
  it.each([updateHomeowner, removeHomeowner])('preserves an access or foreign-key error', async (write) => {
    const error = { code: '23503', message: 'Account has financial records' }
    await expect(write(client({ data: null, error }), 42, {})).rejects.toEqual(error)
  })
  it.each([updateHomeowner, removeHomeowner])('rejects a zero-row single response', async (write) => {
    const error = { code: 'PGRST116', message: 'No row returned' }
    await expect(write(client({ data: null, error }), 42, {})).rejects.toThrow('Refresh and try again')
  })
  it.each([updateHomeowner, removeHomeowner])('propagates connection failures to page error handling', async (write) => {
    const c = client({}); c.query.single.mockRejectedValue(new Error('Offline'))
    await expect(write(c, 42, {})).rejects.toThrow('Offline')
  })
})
