// Display-only interpretation of authoritative charge rows and saved audit events.
// Never invent historical credit transfers or count credit use as received cash.
export function groupMonthlyBillingAudit(charges, events) {
  const evidence = new Map()
  for (const event of events || []) {
    if (!['credit_applied', 'monthly_balance_added'].includes(event?.kind)) continue
    const source = String(event.payload?.source_id || '')
    if (!source) continue
    const record = evidence.get(source) || {}
    if (event.kind === 'credit_applied') record.credit = event.payload
    if (event.kind === 'monthly_balance_added') record.unpaid = event.payload
    evidence.set(source, record)
  }
  return (charges || []).map(charge => {
    const event = evidence.get(String(charge.id)) || {}
    const base = event.credit || event.unpaid
    const creditUsed = base && Number.isFinite(Number(base.credit_used))
      ? Number(base.credit_used) : null
    const unpaidAdded = event.unpaid && Number.isFinite(Number(event.unpaid.unpaid_added))
      ? Number(event.unpaid.unpaid_added)
      : event.credit && Number.isFinite(Number(event.credit.unpaid_charge))
        ? Number(event.credit.unpaid_charge) : null
    return {
      ...charge,
      creditUsed,
      unpaidAdded,
      hasEvidence: !!base,
      fullyCovered: creditUsed !== null && Number(charge.amount) > 0 &&
        creditUsed >= Number(charge.amount) - 0.005,
    }
  })
}

export function summarizeMonthlyBillingAudit(rows) {
  const active = (rows || []).filter(row => !row.voided_at)
  return {
    billed: active.length,
    assessed: active.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    verifiedCredit: active.reduce((sum, row) => sum + (row.creditUsed || 0), 0),
    verifiedUnpaid: active.reduce((sum, row) => sum + (row.unpaidAdded || 0), 0),
    unknown: active.filter(row => !row.hasEvidence).length,
    withCredit: active.filter(row => row.creditUsed > 0).length,
    fullyCovered: active.filter(row => row.fullyCovered).length,
    increasedDue: active.filter(row => row.unpaidAdded > 0).length,
  }
}
