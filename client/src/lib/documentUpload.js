// Upload the Storage object first, then write its metadata. On a metadata
// failure, attempt Storage cleanup and clearly report if cleanup also fails.
// A rejected network promise must not leave the page indefinitely loading.
const DOCUMENT_COLUMNS = 'id, title, category, storage_path, original_file_name, mime_type, file_size, uploaded_by, uploaded_by_name, created_at, deletion_requested_at, deletion_requested_by'

export async function uploadDocumentSafely(client, bucket, objectPath, file, payload) {
  const storage = client.storage.from(bucket)
  const uploaded = await storage.upload(objectPath, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  })
  if (uploaded.error) throw new Error(`Storage upload failed: ${uploaded.error.message}`)

  let inserted
  let metadataError
  try {
    inserted = await client.from('documents').insert(payload)
      .select(DOCUMENT_COLUMNS)
      .single()
    if (inserted.error) throw inserted.error
    if (!inserted.data?.id) throw new Error('Database did not confirm the document record.')
    return inserted.data
  } catch (error) {
    metadataError = error
  }

  // A timed-out INSERT may have committed. Verify first: deleting its bytes
  // would otherwise leave a successful document record with a broken download.
  // If verification is unavailable, retain the object for safe reconciliation.
  try {
    const found = await client.from('documents').select(DOCUMENT_COLUMNS)
      .eq('storage_path', objectPath).maybeSingle()
    if (found.error) throw found.error
    if (found.data) {
      if (found.data.storage_path === objectPath && found.data.id) return found.data
      throw new Error('The recovered document record did not match the upload.')
    }
  } catch (verificationError) {
    throw new Error(
      `The document upload result is uncertain (${metadataError?.message || 'unknown error'}). ` +
      `The uploaded file was retained because its database status could not be verified ` +
      `(${verificationError?.message || 'verification failed'}). Refresh the library before retrying; ` +
      `an administrator may need to reconcile ${objectPath}.`,
    )
  }

  try {
    const cleanup = await storage.remove([objectPath])
    if (cleanup.error) throw cleanup.error
  } catch (cleanupError) {
    throw new Error(
      `Document record could not be saved (${metadataError?.message || 'unknown error'}). ` +
      `Storage cleanup also failed (${cleanupError?.message || 'unknown error'}). ` +
      `A staff administrator should check the orphaned object at ${objectPath}.`,
    )
  }
  throw new Error(`Document record could not be saved: ${metadataError?.message || 'Please retry.'}`)
}
