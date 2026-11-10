const manilaYearMonth = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  timeZone: 'Asia/Manila',
})

export function getManilaYearMonth(value) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  const parts = Object.fromEntries(
    manilaYearMonth.formatToParts(parsed).map(({ type, value: part }) => [type, Number(part)]),
  )
  return { year: parts.year, month: parts.month - 1 }
}

export function homeownerPaymentTotals(records, monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  let allTime = 0
  let thisYear = 0
  let thisMonth = 0

  for (const record of records) {
    if (record.statusKey === 'voided') continue
    const amount = Math.round(record.amount * 100)
    allTime += amount

    const paid = getManilaYearMonth(record.paidAt)
    if (paid?.year !== year || paid.month >= month) continue
    thisYear += amount
    if (paid.month === month - 1) thisMonth += amount
  }

  return { allTime: allTime / 100, thisYear: thisYear / 100, thisMonth: thisMonth / 100 }
}

export function paymentTrackerStatus(records) {
  if (records.length === 0) return { key: 'empty', label: 'No payments recorded' }
  if (records.some(({ statusKey }) => statusKey === 'partial' || statusKey === 'pending')) {
    return { key: 'partial', label: 'Includes partial or pending transactions' }
  }
  return { key: 'recorded', label: 'Payments recorded' }
}

export function serviceInvoiceBalances(transactions) {
  const settlements = new Map()
  for (const row of transactions) {
    if (row.balance_of != null && String(row.payment_status).trim().toLowerCase() !== 'voided') {
      const cents = Math.round(Number(row.amount_paid) * 100)
      settlements.set(row.balance_of, (settlements.get(row.balance_of) || 0) + cents)
    }
  }

  return new Map(transactions.map(row => {
    const due = Math.round(Number(row.amount_due) * 100)
    const paid = Math.round(Number(row.amount_paid) * 100)
    return [row.id, Math.max(0, due - paid - (settlements.get(row.id) || 0)) / 100]
  }))
}
