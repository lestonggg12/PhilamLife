
const cents = (value) => Math.round((Number(value) || 0) * 100)

// Input to this helper is already in cents. Convert to pesos once.
const toAmount = (centValue) => centValue / 100

const normalizeStatus = (value) =>
  String(value ?? '').trim().toLowerCase()

const isVoided = (record) =>
  normalizeStatus(record?.status) === 'voided'

function chargeEntries(charge) {
  const amount = Math.max(cents(charge.amount), 0)
  const baseDescription =
    charge.description || charge.charge_type || 'Charge'

  const description = charge.voided_at
    ? `${baseDescription} (Voided)`
    : baseDescription

  const referenceNumber = charge.billing_month
    ? String(charge.billing_month).slice(0, 7)
    : ''

  // Preserve the original charge row for the existing ledger behavior.
  // Do not add a separate reversal row here.
  return [
    {
      id: `charge-${charge.id}`,
      date: charge.voided_at || charge.created_at,
      description,
      reference_number: referenceNumber,
      debit: amount,
      credit: 0,
      delta: amount,
      paymentAmount: 0,
      paymentEffect: 0,
      explicitAllocated: 0,
    },
  ]
}

function paymentEntry(payment) {
  const voided = isVoided(payment)

  const amountPaid = Math.max(
    cents(payment.amount_paid ?? payment.amount),
    0,
  )

  const originalEffect = Math.max(
    cents(
      payment.balance_effect ??
        payment.amount_paid ??
        payment.amount,
    ),
    0,
  )

  const releasedEffect = Math.min(
    Math.max(cents(payment.effect_released), 0),
    originalEffect,
  )

  const effectiveEffect = Math.max(
    originalEffect - releasedEffect,
    0,
  )

  const allocations = Array.isArray(payment.allocations)
    ? payment.allocations
    : []

  const explicitAllocated = voided
    ? 0
    : allocations.reduce(
        (sum, allocation) =>
          sum + Math.max(cents(allocation.allocated_amount), 0),
        0,
      )

  return {
    id: `payment-${payment.id}`,
    date: payment.paid_at || payment.created_at,
    description: `${
      payment.coverage_period ||
      payment.description ||
      'Payment'
    }${voided ? ' (Voided)' : ''}`,
    reference_number:
      payment.reference_number || payment.receipt_number || '',
    debit: voided ? effectiveEffect : 0,
    credit: voided ? 0 : amountPaid,
    delta: voided ? effectiveEffect : -effectiveEffect,
    paymentAmount: voided ? 0 : amountPaid,
    paymentEffect: voided ? 0 : effectiveEffect,
    explicitAllocated,
  }
}


function compareEntries(a, b) {
  const timeA = a.date ? new Date(a.date).getTime() : 0
  const timeB = b.date ? new Date(b.date).getTime() : 0

  const safeTimeA = Number.isFinite(timeA) ? timeA : 0
  const safeTimeB = Number.isFinite(timeB) ? timeB : 0

  if (safeTimeA !== safeTimeB) {
    return safeTimeA - safeTimeB
  }

  // For transactions on the same date, show payments before charges
  // that were voided later, matching the expected ledger history.
  const aVoidedCharge = a.id.startsWith('charge-') &&
    a.description.includes('(Voided)')
  const bVoidedCharge = b.id.startsWith('charge-') &&
    b.description.includes('(Voided)')

  if (aVoidedCharge !== bVoidedCharge) {
    return aVoidedCharge ? 1 : -1
  }

  return a.id.localeCompare(b.id)
}


export function buildLedgerStatement({
  payments = [],
  charges = [],
  storedBalance = 0,
  openingBalance = null,
  openingBalanceNote = '',
}) {
  const entries = [
    ...charges.flatMap(chargeEntries),
    ...payments.map(paymentEntry),
  ].sort(compareEntries)

  // All transaction effects are stored internally in cents.
  const historyDelta = entries.reduce(
    (sum, entry) => sum + entry.delta,
    0,
  )

  const storedBalanceCents = cents(storedBalance)

  const inferredOpening = storedBalanceCents - historyDelta
  const hasExplicitOpening = openingBalance != null

  const opening = hasExplicitOpening
    ? cents(openingBalance)
    : inferredOpening

  let running = opening

  const paymentTotals = entries.reduce(
    (totals, entry) => ({
      received: totals.received + entry.paymentAmount,
      appliedEffect: totals.appliedEffect + entry.paymentEffect,
      explicitlyAllocated:
        totals.explicitlyAllocated + entry.explicitAllocated,
    }),
    {
      received: 0,
      appliedEffect: 0,
      explicitlyAllocated: 0,
    },
  )

  const lines = []

  if (opening !== 0) {
    lines.push({
      id: 'opening',
      transaction_date: entries[0]?.date || null,
      description: hasExplicitOpening
        ? `Opening balance brought forward${
            openingBalanceNote ? ` (${openingBalanceNote})` : ''
          }`
        : 'Opening balance brought forward (history incomplete)',
      reference_number: '',
      debit: Math.max(opening, 0) / 100,
      credit: Math.max(-opening, 0) / 100,
      running_balance: opening / 100,
    })
  }

  for (const entry of entries) {
    running += entry.delta

    lines.push({
      id: entry.id,
      transaction_date: entry.date || null,
      description: entry.description,
      reference_number: entry.reference_number || '',
      debit: entry.debit / 100,
      credit: entry.credit / 100,
      running_balance: running / 100,
    })
  }

  const finalLedgerBalance = running

  const totalChargeDebits = entries.reduce(
    (sum, entry) => sum + entry.debit,
    0,
  )

  const totalChargeCredits = entries.reduce(
    (sum, entry) => sum + entry.credit,
    0,
  )

  const inferredAllocated = Math.max(
    paymentTotals.appliedEffect -
      paymentTotals.explicitlyAllocated,
    0,
  )

  const unallocated = Math.max(
    paymentTotals.received - paymentTotals.appliedEffect,
    0,
  )

  const reconciliationDifference =
    finalLedgerBalance - storedBalanceCents

  return {
    lines,
    totals: {
      finalBalance: toAmount(finalLedgerBalance),

      outstandingBalance: toAmount(
        Math.max(finalLedgerBalance, 0),
      ),
      availableCredit: toAmount(
        Math.max(-finalLedgerBalance, 0),
      ),

      charges: toAmount(
        Math.max(opening, 0) + totalChargeDebits,
      ),
      chargeReversals: toAmount(totalChargeCredits),
      payments: toAmount(paymentTotals.received),
      allocated: toAmount(paymentTotals.appliedEffect),
      explicitlyAllocated: toAmount(
        paymentTotals.explicitlyAllocated,
      ),
      inferredAllocated: toAmount(inferredAllocated),
      unallocated: toAmount(unallocated),

      openingBalance: toAmount(opening),
      inferredOpeningBalance: toAmount(inferredOpening),
      openingBalanceWasInferred: !hasExplicitOpening,
      openingBalanceNote,

      storedBalance: toAmount(storedBalanceCents),
      reconciliationDifference: toAmount(
        reconciliationDifference,
      ),
      reconcilesWithStoredBalance:
        reconciliationDifference === 0,
    },
  }
}
