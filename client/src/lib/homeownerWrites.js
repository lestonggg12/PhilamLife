function confirmedRow(result, action) {
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  if (result.error || result.data?.id == null) throw new Error(`No homeowner was ${action}. Refresh and try again; the record or your access may have changed.`)
  return result.data
}

export async function updateHomeowner(client, id, payload) {
  return confirmedRow(await client.from('properties').update(payload).eq('id', id).select('id').single(), 'updated')
}

export async function removeHomeowner(client, id) {
  return confirmedRow(await client.from('properties').delete().eq('id', id).select('id').single(), 'removed')
}
