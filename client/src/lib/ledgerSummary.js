import { ledgerCentavos as cents } from './ledgerStatement.js'

function byProperty(rows, key = 'property_id') {
  const index = new Map()
  for (const row of rows) {
    const id = String(row[key] ?? '')
    if (!/^\d+$/.test(id) || index.has(id)) throw new Error('A ledger result is missing an account identifier or contains a duplicate lot.')
    index.set(id, row)
  }
  return index
}

export function verifyLedgerSources(properties, financialRows, payments, agingRows, progress) {
  if (![properties, financialRows, payments, agingRows, progress].every(Array.isArray)) {
    throw new Error('One or more ledger queries returned an incomplete response.')
  }
  const lots = byProperty(properties, 'id')
  const financial = byProperty(financialRows)
  const payment = byProperty(payments)
  const aging = byProperty(agingRows)
  const paymentProgress = byProperty(progress)
  if (financial.size !== lots.size || aging.size !== lots.size ||
      [...payment.keys(), ...paymentProgress.keys()].some(id => !lots.has(id))) {
    throw new Error('Ledger sources returned different lots. Refresh before relying on the totals.')
  }
  for (const [id, lot] of lots) {
    const record = financial.get(id)
    const agingRecord = aging.get(id)
    if (!record || !agingRecord ||
        cents(lot.current_balance) !== cents(record.stored_balance) ||
        Math.max(0, cents(lot.current_balance)) !== cents(agingRecord.total_due) ||
        cents(lot.opening_balance, true) !== cents(record.opening_balance) ||
        record.homeowner_status !== lot.homeowner_status) {
      throw new Error('Account balances changed or could not be reconciled between ledger reads. Refresh to retry.')
    }
    if (cents(record.active_charges) < 0 || (payment.has(id) && cents(payment.get(id).total_paid) < 0)) {
      throw new Error('The ledger received an invalid charge or collection amount.')
    }
    if (payment.has(id)) {
      cents(payment.get(id).latest_previous_balance, true)
      cents(payment.get(id).latest_amount_paid, true)
    }
  }
  return { financial, payment, aging, paymentProgress }
}

export function summarizeLedgerEntries(entries) {
  const totals = { totalDue: 0, totalPaid: 0, totalBalance: 0, totalCredit: 0 }
  for (const entry of entries) {
    totals.totalDue += cents(entry.recordedCharges) + Math.max(cents(entry.opening_balance, true), 0)
    totals.totalPaid += cents(entry.totalPaid)
    totals.totalBalance += cents(entry.balance)
    totals.totalCredit += cents(entry.unallocatedCredit)
  }
  if (!Object.values(totals).every(Number.isSafeInteger)) throw new Error('Ledger totals exceed the supported range.')
  return Object.fromEntries(Object.entries(totals).map(([key, amount]) => [key, amount / 100]))
}

export function verifiedLedgerAging(storedBalance, row) {
  if (row?.aging_complete !== true || typeof row.is_overdue !== 'boolean') return false
  try {
    const overdue = cents(row.overdue_amount)
    const current = cents(row.current_amount)
    return overdue >= 0 && current >= 0 && overdue + current === Math.max(0, cents(storedBalance))
      && row.is_overdue === (overdue > 0)
  } catch {
    return false
  }
}
