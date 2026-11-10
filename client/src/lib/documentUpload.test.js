import { describe, expect, it, vi } from 'vitest'
import { documentUploadRequest, uploadDocumentSafely } from './documentUpload'

const file = new Blob(['test'], { type: 'application/pdf' })
const path = 'documents/unique.pdf'
const payload = {
  title: 'Minutes', category: 'Minutes', original_file_name: 'minutes.pdf',
  mime_type: 'application/pdf', file_size: 4, uploaded_by: 'secretary',
}
const row = { ...payload, id: 'doc-1', storage_path: path, deletion_requested_at: null }

function fixture({ storageError, saved = { data: row }, found = { data: null } } = {}) {
  const upload = storageError ? vi.fn().mockRejectedValue(storageError) : vi.fn().mockResolvedValue({})
  const remove = vi.fn()
  const rpc = vi.fn(() => ({ single: async () => saved }))
  const lookup = { eq: vi.fn(() => lookup), maybeSingle: async () => found }
  return { storage: { from: () => ({ upload, remove }) }, from: () => ({ select: () => lookup }), upload, remove, rpc, lookup }
}
const run = (client) => uploadDocumentSafely(client, 'hoa-documents', path, file, payload)

describe('document upload consistency', () => {
  it('uploads without overwrite, then registers through the verified server endpoint', async () => {
    const db = fixture()
    await expect(run(db)).resolves.toEqual(row)
    expect(db.upload).toHaveBeenCalledWith(path, file, expect.objectContaining({ upsert: false }))
    expect(db.rpc).toHaveBeenCalledWith('register_document_upload', expect.objectContaining({ p_storage_path: path }))
    expect(db.upload.mock.invocationCallOrder[0]).toBeLessThan(db.rpc.mock.invocationCallOrder[0])
  })

  it('registers the same path when the Storage response was lost after upload', async () => {
    const db = fixture({ storageError: new Error('Connection lost') })
    await expect(run(db)).resolves.toEqual(row)
    expect(db.upload).toHaveBeenCalledOnce()
    expect(db.remove).not.toHaveBeenCalled()
  })

  it('recovers a committed matching entry if metadata registration returned an error', async () => {
    const db = fixture({ saved: { error: { message: 'Lost response' } }, found: { data: row } })
    await expect(run(db)).resolves.toEqual(row)
    expect(db.lookup.eq).toHaveBeenCalledWith('storage_path', path)
    expect(db.remove).not.toHaveBeenCalled()
  })

  it.each([{ uploaded_by: 'different' }, { title: 'different' }, { deletion_requested_at: 'pending' }])(
    'rejects a recovered record that is not the available original: %o', async changes => {
      const db = fixture({ saved: { error: { message: 'Unique constraint' } }, found: { data: { ...row, ...changes } } })
      await expect(run(db)).rejects.toThrow('Retry with the same file')
      expect(db.remove).not.toHaveBeenCalled()
    },
  )

  it('keeps the bytes for the same attempt if verification is unavailable', async () => {
    const db = fixture({ saved: { error: { message: 'Offline' } }, found: { error: { message: 'Offline' } } })
    await expect(run(db)).rejects.toThrow('Offline')
    expect(db.remove).not.toHaveBeenCalled()
  })

  it('distinguishes an explicitly retired upload path from a lost response', async () => {
    const db = fixture({ saved: { error: { code: 'PHD01', message: 'Upload again to create a new entry.' } } })
    await expect(run(db)).rejects.toMatchObject({ code: 'PHD01' })
  })

  it('reuses a path for identical bytes and details until confirmation, then uses a fresh path', async () => {
    const pending = new Map()
    const first = await documentUploadRequest(file, payload, 'minutes.pdf', pending)
    expect((await documentUploadRequest(new Blob(['test']), payload, 'minutes.pdf', pending)).path).toBe(first.path)
    expect((await documentUploadRequest(new Blob(['else']), payload, 'minutes.pdf', pending)).path).not.toBe(first.path)
    first.clear()
    expect((await documentUploadRequest(file, payload, 'minutes.pdf', pending)).path).not.toBe(first.path)
  })
})
