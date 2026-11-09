export const FOLLOWUP_COLUMNS = 'id, property_id, action_type, action_date, details, document_reference, created_by'

export async function countCollectionFollowups(client, ids) {
  let total = 0
  // Keep PostgREST URLs short and count without downloading private notes.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { count, error } = await client.from('collection_actions')
      .select('id', { count: 'exact', head: true }).in('property_id', ids.slice(offset, offset + 100))
    if (error) throw error
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Follow-up count is unavailable.')
    total += count
  }
  return total
}

export async function followupRequest(payload, pending) {
  const fingerprint = JSON.stringify(payload)
  let key
  let id
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
    key = 'philamlife:collection:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    id = sessionStorage.getItem(key)
  } catch {
    // Storage is optional. Keep the request ID in memory for in-page retries.
  }
  id = id || pending.get(fingerprint) || crypto.randomUUID()
  pending.set(fingerprint, id)
  try { if (key) sessionStorage.setItem(key, id) } catch { /* optional storage */ }
  return {
    id,
    clear() {
      pending.delete(fingerprint)
      try { if (key) sessionStorage.removeItem(key) } catch { /* optional storage */ }
    },
  }
}

export async function saveCollectionFollowup(client, payload, id) {
  function matches(row) {
    return row?.id === id && String(row.property_id) === String(payload.property_id) &&
      row.created_by === payload.created_by && row.action_type === payload.action_type &&
      row.details === payload.details && row.document_reference === payload.document_reference
  }
  let failure
  try {
    const { data, error } = await client.from('collection_actions').insert({ ...payload, id })
      .select(FOLLOWUP_COLUMNS).single()
    if (!error && matches(data)) return data
    failure = error
  } catch (error) {
    failure = error
  }

  // If the response was lost after commit, the primary key prevents a duplicate.
  const { data, error } = await client.from('collection_actions').select(FOLLOWUP_COLUMNS)
    .eq('id', id).eq('created_by', payload.created_by).maybeSingle()
  if (!error && matches(data)) return data
  throw new Error(failure?.message || 'The follow-up save could not be confirmed.')
}
