export function duplicateLotMessage(block, lotNumber) {
  const name = String(block).trim()
  const label = /^block\s/i.test(name) ? name : `Block ${name}`
  return `${label}, Lot ${lotNumber} already has an active homeowner.`
}

export function isDuplicateLotError(error) {
  return error?.code === '23505' &&
    String(error.message).includes('properties_one_active_homeowner_per_lot_idx')
}
