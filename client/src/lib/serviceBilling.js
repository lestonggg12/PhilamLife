// All client-facing service amounts are calculated in integer centavos.
// PostgreSQL independently validates and calculates the final bill.
export function hourlyBillableHours(startMinutes, endMinutes) {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || endMinutes <= startMinutes) return null
  return Math.round(((endMinutes - startMinutes) / 60) * 10000) / 10000
}

export function serviceAmountDue(service, quantity, startMinutes, endMinutes) {
  const rateCents = Math.round(Number(service?.rate) * 100)
  if (!Number.isSafeInteger(rateCents) || rateCents <= 0) return 0
  if (service?.rate_unit === 'per hour') {
    if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || endMinutes <= startMinutes) return 0
    return Math.round(rateCents * (endMinutes - startMinutes) / 60) / 100
  }
  const count = Number(quantity)
  if (!Number.isSafeInteger(count) || count < 1) return 0
  return Math.round(rateCents * count) / 100
}