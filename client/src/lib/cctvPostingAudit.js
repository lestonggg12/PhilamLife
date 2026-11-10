/** Read-only checks for CCTV compensation; never infer a posted credit from approval alone. */
const cents = (value) => {
  if (value == null || !/^-?\d+(?:\.\d{1,2})?$/.test(String(value).trim())) return NaN
  return Math.round(Number(value) * 100)
}

export function cctvPostingAudit(schedule, charges = [], adjustments = []) {
  const start = String(schedule.starts_on || '').slice(0, 7)
  const end = schedule.ends_before ? String(schedule.ends_before).slice(0, 7) : null
  const approved = cents(schedule.monthly_credit)
  const bills = charges.filter((charge) => {
    const month = String(charge.billing_month || '').slice(0, 7)
    return charge.charge_type === 'Association Dues' && !charge.voided_at &&
      /^\d{4}-\d{2}$/.test(month) && month >= start && (!end || month < end)
  })
  const details = bills.map((bill) => {
    const expected = Math.min(approved, cents(bill.amount))
    const records = adjustments.filter((a) =>
      String(a.charge_id) === String(bill.id) && !a.reversed_at &&
      String(a.approval_reference || '').startsWith('CCTV:'))
    const posted = records.reduce((sum, row) => sum - cents(row.balance_effect), 0)
    const correctReference = records.every((row) =>
      row.approval_reference === `CCTV:${bill.id}:${schedule.id}`)
    return {
      month: String(bill.billing_month).slice(0, 7),
      expected: expected / 100,
      posted: posted / 100,
      correct: Number.isFinite(expected) && expected >= 0 &&
        records.length === (expected > 0 ? 1 : 0) &&
        posted === expected && correctReference,
    }
  })
  const billIds = new Set(bills.map((bill) => String(bill.id)))
  const orphanCredits = adjustments.filter((row) =>
    !row.reversed_at && String(row.approval_reference || '').endsWith(`:${schedule.id}`) &&
    String(row.approval_reference || '').startsWith('CCTV:') && !billIds.has(String(row.charge_id)))
  return {
    billedMonths: details.length,
    postedMonths: details.filter((bill) => bill.correct).length,
    postedAmount: details.reduce((sum, bill) => sum + bill.posted, 0),
    issues: [...details.filter((bill) => !bill.correct),
      ...orphanCredits.map((row) => ({ month: `orphan credit ${row.charge_id}`, correct: false }))],
  }
}
