// Use the saved person ID, never a matching name, to group transfer choices.
export function transferChoices(lots, previousProperty) {
  const people = new Map()
  for (const lot of lots) {
    if (!lot.homeowner_id || lot.homeowner_status !== 'active' ||
      String(lot.id) === String(previousProperty.id) ||
      lot.homeowner_id === previousProperty.homeowner_id) continue
    const existing = people.get(lot.homeowner_id)
    const lotLabel = `${lot.block}, Lot ${lot.lot_number}`
    if (existing) existing.lots.push(lotLabel)
    else people.set(lot.homeowner_id, { ...lot, lots: [lotLabel] })
  }
  return [...people.values()]
}

export function transferRequest(previousProperty, form) {
  if (!previousProperty?.id || !previousProperty.homeowner_id || previousProperty.homeowner_status !== 'active') {
    throw new Error('Reload the active homeowner account before transferring it.')
  }
  const common = {
    p_previous_property_id: previousProperty.id,
    p_expected_homeowner_id: previousProperty.homeowner_id,
    p_effective_date: form.effectiveDate,
    p_note: form.reason.trim() || null,
  }
  if (form.transferTo === 'existing') {
    if (!form.targetProperty?.homeowner_id) throw new Error('Select an existing homeowner from the results.')
    return { name: 'transfer_homeowner_to_existing_guarded', args: { ...common, p_target_property_id: form.targetProperty.id, p_expected_target_homeowner_id: form.targetProperty.homeowner_id } }
  }
  const name = form.newHomeownerName.trim()
  if (!name) throw new Error('Enter the new homeowner name.')
  return { name: 'transfer_homeowner_guarded', args: { ...common, p_new_homeowner_name: name } }
}
