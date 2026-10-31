// Always select a property ID: one person can own multiple independently billed lots.
export function findActivePaymentLot(properties, propertyId) {
  if (propertyId == null || String(propertyId).trim() === '') return null
  return properties.find((property) =>
    String(property.id) === String(propertyId) &&
    String(property.homeowner_status || 'active').trim().toLowerCase() === 'active',
  ) || null
}

export function paymentLotFields(property) {
  return {
    propertyId: String(property.id),
    homeownerName: property.homeowner_name,
    blockName: property.block,
    lotNumber: String(property.lot_number),
    previousBalance: String(property.current_balance ?? 0),
  }
}
