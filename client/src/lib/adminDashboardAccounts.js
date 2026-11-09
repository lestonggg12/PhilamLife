import { describeOverdueAccount, summarizeOverdueAccounts } from './overdueAccounts'

export function summarizeAdminAccounts(properties, overdueRows, duesRows) {
  const active = properties.filter((property) => (property.homeowner_status || 'active') === 'active')
  const overdueByProperty = new Map(overdueRows.map((row) => [Number(row.property_id), row]))
  const duesByProperty = new Map(duesRows.map((row) => [Number(row.property_id), row.monthly_dues]))
  const owners = new Set()
  const aging = []
  const balances = { balanceDue: 0, advanceCredit: 0, clear: 0, total: active.length }
  let targetCents = 0
  let targetComplete = true

  for (const property of active) {
    if (property.homeowner_id) owners.add(property.homeowner_id)
    const balance = Number(property.current_balance)
    if (balance > 0) balances.balanceDue += 1
    else if (balance < 0) balances.advanceCredit += 1
    else balances.clear += 1

    const status = overdueByProperty.get(Number(property.id))
    const verifiedAging = status?.aging_complete === true
      && Number(status.balance) === Math.max(balance, 0)
    aging.push(describeOverdueAccount(property, verifiedAging ? status : null))

    const due = duesByProperty.get(Number(property.id))
    if (due == null || !Number.isFinite(Number(due)) || Number(due) < 0) targetComplete = false
    else targetCents += Math.round(Number(due) * 100)
  }

  return {
    balances,
    owners: owners.size,
    overdue: summarizeOverdueAccounts(aging),
    monthlyDuesTarget: targetComplete ? targetCents / 100 : null,
  }
}
