// Keep only a request key in session storage. The digest scopes retries to the
// same signed-in staff member, lot and form values without storing the note.
export async function balanceEntryRequest(payload, actor, pending) {
  const fingerprint = JSON.stringify([actor, payload])
  let storageKey
  let existing
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
    storageKey = 'philamlife:balance-entry:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    existing = sessionStorage.getItem(storageKey)
  } catch {
    // Retain in-memory retry protection if storage is blocked.
  }
  const id = existing || pending.get(fingerprint) || crypto.randomUUID()
  pending.set(fingerprint, id)
  try { if (storageKey) sessionStorage.setItem(storageKey, id) } catch { /* optional storage */ }
  return {
    id,
    clear() {
      pending.delete(fingerprint)
      try { if (storageKey) sessionStorage.removeItem(storageKey) } catch { /* optional storage */ }
    },
  }
}

export async function submitBalanceEntry(client, payload, actor, requestId) {
  let failure
  try {
    const { data, error } = await client.from('balance_entries')
      .insert({ ...payload, submission_id: requestId }).select('id').single()
    if (!error && data?.id) return data
    failure = error
  } catch (error) {
    failure = error
  }

  // The first response may have been lost after the insert committed.
  const { data, error } = await client.from('balance_entries')
    .select('id, category, amount, as_of_date, description, voided_at')
    .eq('submission_id', requestId).eq('property_id', payload.property_id)
    .eq('created_by', actor).maybeSingle()
  if (!error && data?.id &&
    data.category === payload.category && Number(data.amount) === Number(payload.amount) &&
    data.as_of_date === payload.as_of_date && data.description === payload.description) {
    if (data.voided_at) throw new Error('This submission was saved and later voided. Check the account history.')
    return data
  }
  throw new Error(failure?.message || 'The balance entry could not be confirmed.')
}
