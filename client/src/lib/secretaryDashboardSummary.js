// Pure Secretary Dashboard totals; all financial addition happens in centavos.
function cents(value, label) {
  if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value))) {
    throw new Error(`${label} is unavailable.`)
  }
  const amount = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(amount)) throw new Error(`${label} is outside the supported range.`)
  return amount
}

export function secretaryDashboardSummary(properties, monthlyRows, { year, month }) {
  if (!Array.isArray(properties) || !Array.isArray(monthlyRows)) throw new Error('Dashboard records are unavailable.')
  const key = `${year}-${month}`
  let yearlyCents = 0
  let duesCents = 0
  let receiptsThisMonth = 0
  for (const row of monthlyRows) {
    const period = String(row.month_start || '').slice(0, 7)
    if (period.slice(0, 4) !== String(year)) continue
    yearlyCents += cents(row.dues_collected, 'Yearly collections')
    if (period === key) {
      duesCents += cents(row.dues_only_collected, 'Monthly dues')
      const receipts = Number(row.dues_only_receipts)
      if (!Number.isSafeInteger(receipts) || receipts < 0) throw new Error('Receipt count is unavailable.')
      receiptsThisMonth += receipts
    }
  }
  let outstandingAccounts = 0
  for (const property of properties) {
    if ((property.homeowner_status || 'active') !== 'active') continue
    if (cents(property.current_balance, 'Homeowner balance') > 0) outstandingAccounts++
  }
  return { monthlyCollections: duesCents / 100, yearlyCollections: yearlyCents / 100, outstandingAccounts, receiptsThisMonth }
}
