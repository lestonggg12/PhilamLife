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
