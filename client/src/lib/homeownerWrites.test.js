import { describe, expect, it, vi } from 'vitest'
import { updateHomeowner, removeHomeowner } from './homeownerWrites'
function client(result) {
  const query = { is: vi.fn(() => query), eq: vi.fn(() => query), select: vi.fn(() => query), single: vi.fn().mockResolvedValue(result) }
  const table = { update: vi.fn(() => query), delete: vi.fn(() => query) }
  return { from: vi.fn(() => table), rpc: vi.fn().mockResolvedValue(result), table, query }
}
describe('confirmed homeowner writes', () => {
  it('confirms an updated row', async () => {
    const c = client({ data: { id: 42 }, error: null })
    expect(await updateHomeowner(c, 42, { homeowner_name: 'Updated owner' })).toEqual({ id: 42 })
    expect(c.from).toHaveBeenCalledWith('properties')
    expect(c.table.update).toHaveBeenCalledOnce()
    expect(c.query.eq).toHaveBeenCalledWith('id', 42)
    expect(c.query.select).toHaveBeenCalledWith('id')
    expect(c.query.single).toHaveBeenCalledOnce()
  })
  it('checks the original owner, account status and changed values on save', async () => {
    const c = client({ data: { id: 42 } })
    await updateHomeowner(c, 42, { lot_size_sqm: 128, homeowner_name: 'Corrected name' }, {
      homeowner_id: 'owner-id', homeowner_status: 'active', lot_size_sqm: null, homeowner_name: 'Old name',
    })
    expect(c.query.eq.mock.calls).toEqual([
      ['id', 42], ['homeowner_id', 'owner-id'], ['homeowner_status', 'active'], ['homeowner_name', 'Old name'],
    ])
    expect(c.query.is).toHaveBeenCalledWith('lot_size_sqm', null)
  })
  it('deletes only through the guarded history-aware RPC', async () => {
    const c = client({ data: [{ deleted_property_id: 42 }], error: null })
    await expect(removeHomeowner(c, 42)).resolves.toEqual({ id: 42 })
    expect(c.rpc).toHaveBeenCalledWith('delete_empty_property_guarded', { p_property_id: 42 })
    expect(c.from).not.toHaveBeenCalled()
  })
  it('rejects an update RLS no-op instead of confirming success', async () => {
    await expect(updateHomeowner(client({ data: null, error: null }), 42, {})).rejects.toThrow('No homeowner was')
  })
  it('rejects a missing guarded delete confirmation', async () => {
    await expect(removeHomeowner(client({ data: [], error: null }), 42)).rejects.toThrow('No homeowner was removed')
  })
  it.each([updateHomeowner, removeHomeowner])('preserves an access or foreign-key error', async (write) => {
    const error = { code: '23503', message: 'Account has financial records' }
    await expect(write(client({ data: null, error }), 42, {})).rejects.toEqual(error)
  })
  it('rejects a zero-row update response', async () => {
    const error = { code: 'PGRST116', message: 'No row returned' }
    await expect(updateHomeowner(client({ data: null, error }), 42, {})).rejects.toThrow('Refresh and try again')
  })
  it.each([updateHomeowner, removeHomeowner])('propagates connection failures to page error handling', async (write) => {
    const c = client({})
    if (write === updateHomeowner) c.query.single.mockRejectedValue(new Error('Offline'))
    else c.rpc.mockRejectedValue(new Error('Offline'))
    await expect(write(c, 42, {})).rejects.toThrow('Offline')
  })
})
