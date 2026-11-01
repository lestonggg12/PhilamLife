// monthly_collections is already aggregated by the database in Manila time.
// dues_collected is the legacy name for ALL homeowner cash receipts; it
// includes Balance Payments and fees. Service transactions are separate.
export function monthlyCollection(row, role) {
  const duesOnly = role === 'secretary'
  return {
    amount: Number(row?.[duesOnly ? 'dues_only_collected' : 'dues_collected']) || 0,
    receipts: Number(row?.[duesOnly ? 'dues_only_receipts' : 'dues_receipts']) || 0,
  }
}
