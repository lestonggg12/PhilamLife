export const DOCUMENT_COLUMNS = 'id, title, category, storage_path, original_file_name, mime_type, file_size, uploaded_by, uploaded_by_name, created_at, deletion_requested_at, deletion_requested_by'

const hex = (buffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('')

export async function documentUploadRequest(file, payload, safeName, pending) {
  const digest = hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))
  const key = 'philamlife:document-upload:' + hex(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([digest, payload]))))
  let path
  try { path = sessionStorage.getItem(key) } catch { /* in-memory fallback */ }
  path = path || pending.get(key) || `documents/${crypto.randomUUID()}-${safeName}`
  pending.set(key, path)
  try { sessionStorage.setItem(key, path) } catch { /* optional storage */ }
  return {
    path,
    clear() {
      pending.delete(key)
      try { sessionStorage.removeItem(key) } catch { /* optional storage */ }
    },
  }
}

export async function uploadDocumentSafely(client, bucket, objectPath, file, payload) {
  const storage = client.storage.from(bucket)
  const intent = { ...payload, storage_path: objectPath }
  const matches = row => Boolean(row?.id && !row.deletion_requested_at &&
    row.storage_path === objectPath && row.uploaded_by === intent.uploaded_by &&
    row.title === intent.title && row.category === intent.category &&
    row.original_file_name === intent.original_file_name && row.mime_type === intent.mime_type &&
    Number(row.file_size) === Number(intent.file_size))

  let storageError
  try {
    const uploaded = await storage.upload(objectPath, file, {
      cacheControl: '0', contentType: intent.mime_type, upsert: false,
    })
    storageError = uploaded.error
  } catch (error) {
    storageError = error
  }

  // The server verifies object existence and ownership, even after an ambiguous
  // Storage response. A retry uses the same object path and cannot overwrite it.
  let metadataError
  try {
    const saved = await client.rpc('register_document_upload', {
      p_title: intent.title,
      p_category: intent.category,
      p_storage_path: objectPath,
      p_original_file_name: intent.original_file_name,
      p_mime_type: intent.mime_type,
      p_file_size: intent.file_size,
    }).single()
    if (!saved.error && matches(saved.data)) return saved.data
    metadataError = saved.error
  } catch (error) {
    metadataError = error
  }
  try {
    const found = await client.from('documents').select(DOCUMENT_COLUMNS)
      .eq('storage_path', objectPath).maybeSingle()
    if (!found.error && matches(found.data)) return found.data
  } catch { /* the same request can be retried without copying or deleting bytes */ }

  if (metadataError?.code === 'PHD01') {
    throw Object.assign(new Error(metadataError.message), { code: metadataError.code })
  }
  const message = storageError?.message || metadataError?.message || 'The server did not confirm the document.'
  throw new Error(`Upload could not be confirmed. ${message} Retry with the same file, title, and category.`)
}
