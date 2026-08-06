import { supabase } from './supabaseClient'

const firstValue = (row, keys, fallback = null) => {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null) return row[key]
  }
  return fallback
}

export const moneyValue = (row, keys) => {
  const value = Number(firstValue(row, keys, 0))
  return Number.isFinite(value) ? value : 0
}

export function normalizeLedgerAccount(row) {
  const balance = moneyValue(row, [
    'outstanding_balance',
    'balance_due',
    'current_balance',
    'balance',
    'total_balance',
  ])

  return {
    ...row,
    propertyId: firstValue(row, ['property_id', 'id']),
    homeownerName: firstValue(row, ['homeowner_name', 'owner_name'], 'Unknown homeowner'),
    blockName: firstValue(row, ['block_name', 'block'], '—'),
    lotNumber: firstValue(row, ['lot_number', 'lot'], '—'),
    totalCharges: moneyValue(row, ['total_charges', 'charges_total', 'total_assessed']),
    totalPaid: moneyValue(row, ['total_payments', 'total_paid', 'payments_total', 'allocated_payments']),
    totalAdjustments: moneyValue(row, ['total_adjustments', 'adjustments_total', 'net_adjustments']),
    balance,
    unallocatedCredit: moneyValue(row, ['unallocated_credit', 'credit_balance', 'available_credit']),
    current: moneyValue(row, ['current_amount', 'current_due', 'aging_current', 'current_bucket']),
    days1To30: moneyValue(row, ['days_1_30', 'aging_1_30', 'overdue_1_30', 'bucket_1_30']),
    days31To60: moneyValue(row, ['days_31_60', 'aging_31_60', 'overdue_31_60', 'bucket_31_60']),
    days61To90: moneyValue(row, ['days_61_90', 'aging_61_90', 'overdue_61_90', 'bucket_61_90']),
    days90Plus: moneyValue(row, ['days_90_plus', 'aging_90_plus', 'overdue_90_plus', 'bucket_90_plus']),
    lastPaymentAt: firstValue(row, ['last_payment_at', 'last_paid_at', 'last_payment_date']),
  }
}

export async function fetchLedgerAccounts() {
  const { data, error } = await supabase
    .from('homeowner_ledger_summary')
    .select('*')

  if (error) throw error
  return (data || []).map(normalizeLedgerAccount)
}

export async function fetchStatementLines(propertyId) {
  const { data, error } = await supabase
    .from('homeowner_statement_lines')
    .select('*')
    .eq('property_id', propertyId)

  if (error) throw error
  return (data || []).sort((left, right) => {
    const leftDate = firstValue(left, ['transaction_date', 'line_date', 'entry_date', 'posted_at', 'created_at'], 0)
    const rightDate = firstValue(right, ['transaction_date', 'line_date', 'entry_date', 'posted_at', 'created_at'], 0)
    return new Date(leftDate) - new Date(rightDate)
  })
}

const missingRpc = (error) =>
  error?.code === 'PGRST202' ||
  error?.code === '42883' ||
  /function .* does not exist|could not find the function/i.test(error?.message || '')

/**
 * Posts a payment through the database transaction that also performs FIFO
 * allocation. Candidate signatures support the deployed ledger migration and
 * make upgrades tolerant of renamed amount parameters without using a direct
 * table insert as an unsafe fallback.
 */
export async function postLedgerPayment(input) {
  const common = {
    p_property_id: Number(input.propertyId),
    p_payment_method: input.paymentMethod,
    p_reference_number: input.referenceNumber || null,
    p_coverage_period: input.coveragePeriod,
    p_note: input.note || null,
  }

  const attempts = [
    ['record_hoa_payment', { ...common, p_amount: Number(input.amount) }],
    ['record_homeowner_payment', { ...common, p_amount: Number(input.amount) }],
    ['post_homeowner_payment', { ...common, p_amount: Number(input.amount) }],
    ['record_payment_with_allocation', { ...common, p_amount: Number(input.amount) }],
    ['record_hoa_payment', { ...common, p_amount_paid: Number(input.amount) }],
    ['record_homeowner_payment', { ...common, p_amount_paid: Number(input.amount) }],
  ]

  let lastError = null
  for (const [functionName, parameters] of attempts) {
    const { data, error } = await supabase.rpc(functionName, parameters)
    if (!error) return Array.isArray(data) ? data[0] : data
    if (!missingRpc(error)) throw error
    lastError = error
  }

  throw new Error(
    lastError?.message ||
      'The ledger payment function is unavailable. Confirm the HOA ledger migration is installed.',
  )
}