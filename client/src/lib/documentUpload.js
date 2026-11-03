// Upload the Storage object first, then write its metadata. On a metadata
// failure, attempt Storage cleanup and clearly report if cleanup also fails.
// A rejected network promise must not leave the page indefinitely loading.
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
      .select('id, title, category, storage_path, original_file_name, mime_type, file_size, uploaded_by, uploaded_by_name, created_at')
      .single()
    if (inserted.error) throw inserted.error
    if (!inserted.data?.id) throw new Error('Database did not confirm the document record.')
    return inserted.data
  } catch (error) {
    metadataError = error
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
