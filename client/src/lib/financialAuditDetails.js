// Read-only interpretation of saved audit evidence. Never changes a balance or
// invents a credit transfer, payment, or penalty-to-month allocation.
const money = (value) => {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount)
    : null
}

export function financialAuditDetails(event) {
  const p = event?.payload || {}
  const result = []
  const push = (label, value) => { const formatted = money(value); if (formatted) result.push(`${label}: ${formatted}`) }
  if (event?.kind === 'credit_applied' || event?.kind === 'monthly_balance_added') {
    if (p.billing_month && /^\d{4}-\d{2}-\d{2}$/.test(p.billing_month)) {
      result.push(`Dues month: ${p.billing_month.slice(0, 7)}`)
    }
    push('Monthly dues assessed', p.charge_amount)
    push('Advance credit consumed (not new cash)', p.credit_used)
    if (event.kind === 'credit_applied') {
      push('Advance credit remaining', p.credit_after)
      push('Unpaid portion of this bill', p.unpaid_charge)
    } else {
      push('Unpaid portion added', p.unpaid_added)
      if (p.balance_before != null) result.push(`Previous account balance: ${Number(p.balance_before).toFixed(2)} PHP`)
      if (p.balance_after != null) result.push(`Account balance after billing: ${Number(p.balance_after).toFixed(2)} PHP`)
    }
    if (p.source_id) result.push(`Monthly charge reference: ${String(p.source_id)}`)
  }
  if (event?.kind === 'penalty_applied') {
    push('Penalty assessed', p.penalty_amount)
    push('Eligible unpaid assessment base', p.base_amount)
    if (p.rate_formatted) result.push(`Annual rate: ${String(p.rate_formatted)}`)
    if (p.anniversary_date) result.push(`Anniversary: ${String(p.anniversary_date)}`)
    if (p.charge_id) result.push(`Penalty charge reference: ${String(p.charge_id)}`)
    result.push('Annual penalty applies to the recorded eligible unpaid base; it is not automatically attributable to one monthly bill.')
  }
  if (event?.kind === 'penalty_collected') {
    push('Payment allocated to penalties', p.penalty_applied)
    push('Cash on receipt (not an additional credit)', p.cash_received)
    if (p.receipt_number) result.push(`Receipt: ${String(p.receipt_number)}`)
    if (p.specific_charge_id) result.push(`Targeted penalty charge: ${String(p.specific_charge_id)}`)
  }
  return result
}
