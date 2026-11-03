import { describe, expect, it, vi } from 'vitest'
import { uploadDocumentSafely } from './documentUpload'

function client({ uploaded = { error: null }, saved = { data: { id: 'doc-1' }, error: null }, removed = { error: null } } = {}) {
  const upload = vi.fn().mockResolvedValue(uploaded)
  const remove = vi.fn().mockResolvedValue(removed)
  const single = vi.fn().mockResolvedValue(saved)
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn(() => ({ select }))
  return { storage: { from: vi.fn(() => ({ upload, remove })) }, from: vi.fn(() => ({ insert })), upload, remove, insert }
}
const file = { type: 'application/pdf' }
const payload = { title: 'Minutes', storage_path: 'documents/unique.pdf' }
const run = (c) => uploadDocumentSafely(c, 'hoa-documents', payload.storage_path, file, payload)

describe('document upload consistency', () => {
  it('uploads before writing metadata and never removes a successful upload', async () => {
    const c = client()
    await expect(run(c)).resolves.toEqual({ id: 'doc-1' })
    expect(c.upload).toHaveBeenCalledWith(payload.storage_path, file, expect.objectContaining({ upsert: false }))
    expect(c.upload.mock.invocationCallOrder[0]).toBeLessThan(c.insert.mock.invocationCallOrder[0])
    expect(c.remove).not.toHaveBeenCalled()
  })
  it('does not write metadata when Storage rejects the upload', async () => {
    const c = client({ uploaded: { error: { message: 'Quota exceeded' } } })
    await expect(run(c)).rejects.toThrow('Quota exceeded')
    expect(c.insert).not.toHaveBeenCalled()
  })
  it('cleans up the uploaded object if metadata saving fails', async () => {
    const c = client({ saved: { data: null, error: { message: 'RLS denied' } } })
    await expect(run(c)).rejects.toThrow('RLS denied')
    expect(c.remove).toHaveBeenCalledWith([payload.storage_path])
  })
  it('reports an orphan if the rollback cannot delete Storage bytes', async () => {
    const c = client({ saved: { data: null, error: { message: 'Database offline' } }, removed: { error: { message: 'Storage offline' } } })
    await expect(run(c)).rejects.toThrow('Storage cleanup also failed')
    expect(c.remove).toHaveBeenCalledTimes(1)
  })
  it('also attempts cleanup on a thrown database/network exception', async () => {
    const c = client()
    c.insert.mockImplementation(() => { throw new Error('Network down') })
    await expect(run(c)).rejects.toThrow('Network down')
    expect(c.remove).toHaveBeenCalledTimes(1)
  })
})
