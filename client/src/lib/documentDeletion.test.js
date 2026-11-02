import { describe, expect, it, vi } from 'vitest'
import { deleteDocumentSafely } from './documentDeletion'
const doc = { id: 'fixture-id', storage_path: 'documents/server-path.pdf', deletion_requested_at: '2026-11-02T08:00:00Z' }
function client({ start, remove, finish } = {}) {
  const c = { rpc: vi.fn().mockResolvedValueOnce(start ?? { data: { document: doc, already_deleted: false }, error: null }).mockResolvedValueOnce(finish ?? { data: true, error: null }) }
  c.remove = vi.fn().mockResolvedValue(remove ?? { data: [{ name: doc.storage_path }], error: null })
  c.storage = { from: vi.fn(() => ({ remove: c.remove })) }
  return c
}
describe('durable document deletion', () => {
  it('marks first, uses the server path, and confirms finalization', async () => {
    const c = client(), pending = vi.fn()
    expect(await deleteDocumentSafely(c, doc.id, pending)).toEqual({ alreadyDeleted: false })
    expect(c.rpc.mock.calls).toEqual([['begin_document_deletion', { p_document_id: doc.id }], ['finish_document_deletion', { p_document_id: doc.id }]])
    expect(c.remove).toHaveBeenCalledWith([doc.storage_path])
    expect(c.rpc.mock.invocationCallOrder[0]).toBeLessThan(c.remove.mock.invocationCallOrder[0])
    expect(c.remove.mock.invocationCallOrder[0]).toBeLessThan(c.rpc.mock.invocationCallOrder[1])
    expect(pending).toHaveBeenCalledWith(doc)
  })
  it('never removes bytes when the marker cannot be saved', async () => {
    const c = client({ start: { data: null, error: { message: 'Forbidden' } } })
    await expect(deleteDocumentSafely(c, doc.id)).rejects.toThrow('Could not start deletion')
    expect(c.remove).not.toHaveBeenCalled(); expect(c.rpc).toHaveBeenCalledTimes(1)
  })
  it('keeps a retryable marker when Storage fails', async () => {
    const c = client({ remove: { data: null, error: { message: 'Offline' } } }), pending = vi.fn()
    await expect(deleteDocumentSafely(c, doc.id, pending)).rejects.toThrow('Retry deletion')
    expect(pending).toHaveBeenCalledWith(doc); expect(c.rpc).toHaveBeenCalledTimes(1)
  })
  it('does not call finalization when the Storage connection throws', async () => {
    const c = client(); c.remove.mockRejectedValue(new Error('Connection lost'))
    await expect(deleteDocumentSafely(c, doc.id)).rejects.toThrow('Deletion is pending')
    expect(c.rpc).toHaveBeenCalledTimes(1)
  })
  it('keeps the pending record when bytes are gone but metadata finalization fails', async () => {
    const c = client({ finish: { data: null, error: { message: 'Audit unavailable' } } })
    await expect(deleteDocumentSafely(c, doc.id)).rejects.toThrow('Deletion is pending')
  })
  it('requires server verification when Storage returns no deleted rows', async () => {
    const c = client({ remove: { data: [], error: null }, finish: { data: null, error: { message: 'The file has not been removed yet' } } })
    await expect(deleteDocumentSafely(c, doc.id)).rejects.toThrow('has not been removed yet')
    expect(c.rpc).toHaveBeenCalledTimes(2)
  })
  it('resumes when the object was removed by the previous attempt', async () => {
    const c = client({ remove: { data: [], error: null } })
    await expect(deleteDocumentSafely(c, doc.id)).resolves.toEqual({ alreadyDeleted: false })
  })
  it('acknowledges an already completed deletion without a second Storage call', async () => {
    const c = client({ start: { data: { already_deleted: true }, error: null } })
    await expect(deleteDocumentSafely(c, doc.id)).resolves.toEqual({ alreadyDeleted: true })
    expect(c.remove).not.toHaveBeenCalled()
  })
  it.each([null, { ...doc, id: 'other' }, { ...doc, deletion_requested_at: null }, { ...doc, storage_path: 'email-campaigns/other.pdf' }])('rejects an unverified response: %j', async (document) => {
    const c = client({ start: { data: { document }, error: null } })
    await expect(deleteDocumentSafely(c, doc.id)).rejects.toThrow('Could not start deletion')
    expect(c.remove).not.toHaveBeenCalled()
  })
  it('does not accept a successful but unconfirmed final response', async () => {
    const c = client({ finish: { data: null, error: null } })
    await expect(deleteDocumentSafely(c, doc.id)).rejects.toThrow('completion could not be confirmed')
  })
})
