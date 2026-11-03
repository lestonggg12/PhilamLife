// Never turn failed collection queries into a verified zero balance.
const validAmount = (value, label) => {
  if (value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`${label} is unavailable.`)
  }
  return Number(value)
}

export function verifiedServiceStats(summaryResult, countResult, balanceResult) {
  for (const [name, result] of [['Summary', summaryResult], ['Receipt count', countResult], ['Unpaid balances', balanceResult]]) {
    if (result?.error) throw new Error(`${name}: ${result.error.message || 'Request failed.'}`)
  }
  const summary = Array.isArray(summaryResult?.data) ? summaryResult.data[0] : summaryResult?.data
  const count = countResult?.count
  if (!summary || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(balanceResult?.data)) {
    throw new Error('Service summary response is incomplete.')
  }
  balanceResult.data.forEach((row) => validAmount(row?.balance_due, 'Unpaid balance'))
  return {
    stats: {
      monthCount: validAmount(summary.service_count, 'Monthly receipt count'),
      monthCollected: validAmount(summary.service_collected, 'Monthly collection'),
      totalReceipts: count,
    },
    balances: balanceResult.data,
  }
}
