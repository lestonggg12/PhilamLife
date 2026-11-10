// Storage bytes must be removed through the Storage API, never SQL. The server
// keeps a pending marker until it verifies removal and commits metadata + audit.
export async function deleteDocumentSafely(client, id, onPending) {
  let pending = false
  try {
    const started = await client.rpc('begin_document_deletion', { p_document_id: id })
    if (started.error) throw started.error
    if (started.data?.already_deleted === true) return { alreadyDeleted: true }
    const document = started.data?.document
    if (document?.id !== id || !document.storage_path?.startsWith('documents/') || !document.deletion_requested_at) {
      throw new Error('The deletion request could not be verified. Refresh and try again.')
    }
    pending = true
    onPending?.(document)
    let removalError
    try {
      const removed = await client.storage.from('hoa-documents').remove([document.storage_path])
      removalError = removed.error
    } catch (error) {
      removalError = error
    }
    // A successful Storage response may contain zero rows. The final RPC checks
    // storage.objects itself; never assume an empty response deleted the file.
    const finished = await client.rpc('finish_document_deletion', { p_document_id: id })
    if (finished.error) throw removalError || finished.error
    if (finished.data !== true) throw new Error('Deletion completion could not be confirmed.')
    return { alreadyDeleted: false }
  } catch (error) {
    const message = error?.message || 'Connection failed.'
    throw new Error(pending
      ? `Deletion is pending. Use Retry deletion to finish. ${message}`
      : `Could not confirm the deletion request. Refresh before trying again. ${message}`)
  }
}
