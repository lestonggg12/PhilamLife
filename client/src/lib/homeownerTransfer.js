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

export function transferRequest(previousPropertyId, form) {
  const common = {
    p_previous_property_id: previousPropertyId,
    p_effective_date: form.effectiveDate,
    p_note: form.reason.trim() || null,
  }
  if (form.transferTo === 'existing') {
    if (!form.targetProperty?.homeowner_id) throw new Error('Select an existing homeowner from the results.')
    return { name: 'transfer_homeowner_to_existing', args: { ...common, p_target_property_id: form.targetProperty.id } }
  }
  const name = form.newHomeownerName.trim()
  if (!name) throw new Error('Enter the new homeowner name.')
  return { name: 'transfer_homeowner', args: { ...common, p_new_homeowner_name: name } }
}
