// Confirm the database actually updated its singleton row before refreshing UI.
export async function saveSystemSettings(client, payload, refreshOrganization) {
  const { data, error } = await client.from('system_settings')
    .update(payload).eq('id', 1).select('*').single()
  if (error) throw error
  if (!data || Number(data.id) !== 1) {
    throw new Error('No settings row was updated. Refresh the page and check your permissions.')
  }

  // The write has committed. A refresh failure must never be called a failed save.
  try {
    const refreshed = await refreshOrganization(data)
    return { settings: data, refreshError: refreshed?.error || null, cacheError: refreshed?.cacheError || null }
  } catch (refreshError) {
    return { settings: data, refreshError, cacheError: null }
  }
}
