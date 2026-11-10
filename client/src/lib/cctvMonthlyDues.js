/** Present the next month's association dues after approved CCTV electricity compensation. */
const asCentavos = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
}

export function cctvMonthlyDues(grossAmount, billingMonth, schedules = []) {
  const grossCents = asCentavos(grossAmount)
  const month = String(billingMonth || '').slice(0, 7)
  const eligible = /^\d{4}-\d{2}$/.test(month)
    ? schedules.find((s) => month >= String(s.starts_on || '').slice(0, 7) &&
      (!s.ends_before || month < String(s.ends_before).slice(0, 7)))
    : null
  const creditCents = eligible ? Math.min(grossCents, asCentavos(eligible.monthly_credit)) : 0
  return {
    gross: grossCents / 100,
    credit: creditCents / 100,
    net: (grossCents - creditCents) / 100,
  }
}
