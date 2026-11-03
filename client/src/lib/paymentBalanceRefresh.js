// Always use the authoritative post-trigger balance after a payment or void.
// Client-side balance arithmetic can be wrong for allocations, advances and
// charge releases. An invalid or unavailable response is not a zero balance.
export async function readPropertyBalance(client, propertyId) {
  const { data, error } = await client.from('properties')
    .select('id, current_balance')
    .eq('id', propertyId)
    .maybeSingle()
  if (error) throw error
  if (!data || data.current_balance == null || !Number.isFinite(Number(data.current_balance))) {
    throw new Error('The latest account balance is unavailable.')
  }
  return Number(data.current_balance)
}
