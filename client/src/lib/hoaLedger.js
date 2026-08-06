import { supabase } from './supabaseClient'
import {
  addRunningBalances,
  calculateCreditsByProperty,
  firstValue,
  moneyValue,
} from './hoaLedgerMath'

export { moneyValue }

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
    homeownerName: firstValue(
      row,
      ['homeowner_name', 'owner_name'],
      'Unknown homeowner',
    ),
    blockName: firstValue(row, ['block_name', 'block'], '—'),
    lotNumber: firstValue(row, ['lot_number', 'lot'], '—'),
    totalCharges: moneyValue(row, ['total_assessed']),
    totalPaid: moneyValue(row, ['total_collected']),
    totalAdjustments: moneyValue(row, [
      'total_adjustments',
      'adjustments_total',
      'net_adjustments',
    ]),
    balance,
    unallocatedCredit: moneyValue(row, ['unallocatedCredit']),
    current: moneyValue(row, ['aging_current']),
    days1To30: moneyValue(row, ['aging_1_30']),
    days31To60: moneyValue(row, ['aging_31_60']),
    days61To90: moneyValue(row, ['aging_61_90']),
    days90Plus: moneyValue(row, ['aging_90_plus']),
    lastPaymentAt: firstValue(row, ['last_payment_at']),
    accountStatus: firstValue(row, ['account_status'], 'Pending'),
  }
}

export async function fetchLedgerAccounts() {
  const [summaryResult, paymentResult, allocationResult] = await Promise.all([
    supabase.from('homeowner_ledger_summary').select('*'),
    supabase
      .from('payments')
      .select('id, property_id, amount, amount_paid, status'),
    supabase
      .from('payment_allocations')
      .select('payment_id, amount, reversed_at'),
  ])

  const error =
    summaryResult.error ||
    paymentResult.error ||
    allocationResult.error

  if (error) throw error

  const creditByProperty = calculateCreditsByProperty(
    paymentResult.data || [],
    allocationResult.data || [],
  )

  return (summaryResult.data || []).map((row) =>
    normalizeLedgerAccount({
      ...row,
      unallocatedCredit:
        creditByProperty.get(Number(row.property_id)) || 0,
    }),
  )
}

export async function fetchStatementLines(propertyId) {
  const { data, error } = await supabase
    .from('homeowner_statement_lines')
    .select('*')
    .eq('property_id', propertyId)

  if (error) throw error

  return addRunningBalances(data || [])
}

/**
 * Posts a payment through the deployed ledger transaction.
 * The database RPC creates the receipt and performs FIFO
 * allocation atomically.
 */
export async function postLedgerPayment(input) {
  const { data, error } = await supabase.rpc(
    'record_hoa_payment',
    {
      p_property_id: Number(input.propertyId),
      p_amount: Number(input.amount),
      p_payment_method: input.paymentMethod,
      p_reference_number: input.referenceNumber || null,
      p_note: input.note || null,
      p_payment_purpose:
        input.paymentPurpose || 'Association Dues',
      p_coverage_period: input.coveragePeriod || null,
    },
  )

  if (error) {
    if (
      error.code === 'PGRST202' ||
      error.code === '42883'
    ) {
      throw new Error(
        'The HOA ledger migration must be applied before recording payments.',
      )
    }

    throw error
  }

  return Array.isArray(data) ? data[0] : data
}