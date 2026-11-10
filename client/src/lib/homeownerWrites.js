function confirmedRow(result, action) {
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  if (result.error || result.data?.id == null) throw new Error(`No homeowner was ${action}. Refresh and try again; the record or your access may have changed.`)
  return result.data
}

export async function updateHomeowner(client, id, payload, original = {}) {
  let query = client.from('properties').update(payload).eq('id', id)
  for (const field of ['homeowner_id', 'homeowner_status', ...Object.keys(payload)]) {
    if (!Object.hasOwn(original, field)) continue
    query = original[field] == null ? query.is(field, null) : query.eq(field, original[field])
  }
  return confirmedRow(await query.select('id').single(), 'updated')
}

export async function removeHomeowner(client, id) {
  const { data, error } = await client.rpc('delete_empty_property_guarded', {
    p_property_id: id,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  if (!row || Number(row.deleted_property_id) !== Number(id)) {
    throw new Error('No homeowner was removed. Refresh and try again; the record or its history may have changed.')
  }
  return { id: row.deleted_property_id }
}
