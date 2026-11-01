import { describe, expect, it, vi } from 'vitest'
import { loadReceiptAlignment, receiptAlignmentOffsets, saveReceiptAlignment } from './receiptAlignment'
function client(result) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(result) }
  return { from: vi.fn(() => query), rpc: vi.fn(() => query), query }
}
describe('shared receipt calibration API', () => {
  it('loads the global singleton without reading a role/browser override', async () => {
    const db = client({ data: { x_mm: '1.25', y_mm: '-0.50', revision: 4 }, error: null })
    expect(await loadReceiptAlignment(db)).toEqual({ x: 1.25, y: -0.5, revision: 4 })
    expect(db.from).toHaveBeenCalledWith('receipt_print_settings')
    expect(db.query.eq).toHaveBeenCalledWith('id', 1)
  })
  it('saves only calibration fields with the version that was loaded', async () => {
    const db = client({ data: { x_mm: 1, y_mm: -1.5, revision: 5 }, error: null })
    expect(await saveReceiptAlignment(db, { x: '1', y: '-1.50' }, 4)).toEqual({ x: 1, y: -1.5, revision: 5 })
    expect(db.rpc).toHaveBeenCalledWith('save_receipt_print_alignment', { p_x_mm: 1, p_y_mm: -1.5, p_expected_revision: 4 })
  })
  it('does not report success or fall back when the query fails', async () => {
    const error = { message: 'Permission denied' }, db = client({ data: null, error })
    await expect(loadReceiptAlignment(db)).rejects.toBe(error)
  })
  it('requires a valid saved row and revision before printing', async () => {
    for (const data of [null, { x_mm: 0, y_mm: 0 }, { x_mm: 0, y_mm: 0, revision: 0 }]) {
      await expect(loadReceiptAlignment(client({ data, error: null }))).rejects.toThrow()
    }
  })
  it('retains stale-save errors instead of silently retrying over another user', async () => {
    const error = { code: '40001', message: 'Reload before saving' }, db = client({ data: null, error })
    await expect(saveReceiptAlignment(db, { x: 0, y: 0 }, 1)).rejects.toBe(error)
    expect(db.rpc).toHaveBeenCalledOnce()
  })
  it.each([{ x: '', y: 0 }, { x: 6, y: 0 }, { x: 0, y: -6 }, { x: 0.001, y: 0 }, { x: Infinity, y: 0 }])('rejects invalid offsets without clamping or saving: %j', async (draft) => {
    const db = client({})
    expect(() => receiptAlignmentOffsets(draft)).toThrow()
    await expect(saveReceiptAlignment(db, draft, 1)).rejects.toThrow()
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
