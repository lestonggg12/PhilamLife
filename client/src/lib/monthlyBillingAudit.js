// Display-only interpretation of authoritative charge rows and saved audit events.
// Never invent historical credit transfers or count credit use as received cash.
export function buildCurrentDuesPeriodQuery(query, { view, month, year }) {
  const scoped = query
    .select('kind,category,ref_id,unpaid')
    .eq('kind', 'dues')
    .eq('category', 'Association Dues')

  return view === 'year'
    ? scoped.gte('item_date', `${year}-01-01`).lt('item_date', `${Number(year) + 1}-01-01`)
    : scoped.eq('item_date', `${month}-01`)
}

function finiteHistoricalAmount(value) {
  if (value == null || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function verifiedPostingBalance(charge, payload) {
  if (payload?.snapshot_version !== 1 || payload?.source_table !== 'property_charges' ||
      String(payload?.property_id) !== String(charge.property_id) ||
      String(payload?.billing_month) !== String(charge.billing_month)) return null
  const before = finiteHistoricalAmount(payload.balance_before)
  const adjustment = finiteHistoricalAmount(payload.billing_time_adjustments)
  const after = finiteHistoricalAmount(payload.balance_after)
  const assessed = finiteHistoricalAmount(payload.charge_amount)
  if (before === null || adjustment === null || after === null || assessed === null ||
      Math.abs(assessed - Number(charge.amount)) > 0.005 ||
      Math.abs(before + assessed + adjustment - after) > 0.005) return null
  return { previousBalance: before, billingTimeAdjustments: adjustment, balanceAfterBilling: after }
}

export function groupMonthlyBillingAudit(charges, events, balanceItems = null) {
  const evidence = new Map()
  for (const event of events || []) {
    if (!['credit_applied', 'monthly_balance_added', 'monthly_billing_posted'].includes(event?.kind)) continue
    const source = String(event.payload?.source_id || '')
    if (!source) continue
    const record = evidence.get(source) || {}
    if (event.kind === 'credit_applied') record.credit = event.payload
    if (event.kind === 'monthly_balance_added') record.unpaid = event.payload
    if (event.kind === 'monthly_billing_posted') record.posting = event.payload
    evidence.set(source, record)
  }
  const currentSettlementAvailable = Array.isArray(balanceItems)
  const currentUnpaidByCharge = new Map()
  for (const item of balanceItems || []) {
    if (item?.kind !== 'dues' || item?.category !== 'Association Dues') continue
    const refId = String(item.ref_id || '')
    if (!refId || item.unpaid == null || item.unpaid === '') continue
    const unpaid = Number(item.unpaid)
    if (!Number.isFinite(unpaid)) continue
    currentUnpaidByCharge.set(refId, unpaid)
  }
  return (charges || []).map(charge => {
    const event = evidence.get(String(charge.id)) || {}
    const base = event.credit || event.unpaid
    const historical = verifiedPostingBalance(charge, event.posting)
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
      billingStatus: charge.voided_at ? 'voided' : 'applied',
      historicalBalanceVerified: historical !== null,
      previousBalance: historical?.previousBalance ?? null,
      billingTimeAdjustments: historical?.billingTimeAdjustments ?? null,
      balanceAfterBilling: historical?.balanceAfterBilling ?? null,
      currentUnpaid: currentSettlementAvailable && currentUnpaidByCharge.has(String(charge.id))
        ? currentUnpaidByCharge.get(String(charge.id))
        : null,
      hasCurrentSettlement: currentSettlementAvailable && currentUnpaidByCharge.has(String(charge.id)),
      fullyCovered: creditUsed !== null && Number(charge.amount) > 0 &&
        creditUsed >= Number(charge.amount) - 0.005,
    }
  })
}

export function summarizeMonthlyBillingAudit(rows) {
  const active = (rows || []).filter(row => !row.voided_at)
  const accountIds = new Set(active.map(row => String(row.property_id || row.id)))
  return {
    billed: active.length,
    accountsBilled: accountIds.size,
    assessed: active.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    verifiedCredit: active.reduce((sum, row) => sum + (row.creditUsed || 0), 0),
    verifiedUnpaid: active.reduce((sum, row) => sum + (row.unpaidAdded || 0), 0),
    unknown: active.filter(row => !row.hasEvidence).length,
    withCredit: active.filter(row => row.creditUsed > 0).length,
    fullyCovered: active.filter(row => row.fullyCovered).length,
    increasedDue: active.filter(row => row.unpaidAdded > 0).length,
    applied: new Set(active.filter(row => row.billingStatus === 'applied').map(row => String(row.property_id || row.id))).size,
    needsReview: null,
  }
}
