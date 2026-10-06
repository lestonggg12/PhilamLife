const cents = (value) => Math.round((Number(value) || 0) * 100)

function chargeEntry(charge) {
  const amount = cents(charge.amount)
  const voided = Boolean(charge.voided_at)

  return {
    id: `charge-${charge.id}`,
    date: voided ? charge.voided_at : charge.created_at,
    description: `${charge.description || charge.charge_type || 'Charge'}${voided ? ' (Voided)' : ''}`,
    reference_number: charge.billing_month ? String(charge.billing_month).slice(0, 7) : '',
    debit: voided ? 0 : amount,
    credit: voided ? amount : 0,
    delta: voided ? -amount : amount,
    paymentAmount: 0,
  }
}

function paymentEntry(payment) {
  const voided = payment.status === 'Voided'
  const amountPaid = cents(payment.amount_paid ?? payment.amount)
  const effect = cents(payment.balance_effect ?? payment.amount_paid ?? payment.amount)
  const allocated = voided ? 0 : effect

  return {
    id: `payment-${payment.id}`,
    date: payment.paid_at || payment.created_at,
    description: `${payment.coverage_period || 'Payment'}${voided ? ' (Voided)' : ''}`,
    reference_number: payment.reference_number || payment.receipt_number,
    debit: voided ? allocated : 0,
    credit: voided ? 0 : amountPaid,
    delta: voided ? allocated : -allocated,
    paymentAmount: voided ? 0 : amountPaid,
  }
}

export function buildLedgerStatement({
  payments = [],
  charges = [],
  storedBalance = 0,
  openingBalance = null,
  openingBalanceNote = '',
}) {
  const entries = [
    ...charges.map(chargeEntry),
    ...payments.map(paymentEntry),
  ].sort((a, b) => {
    const dateDifference = new Date(a.date || 0) - new Date(b.date || 0)
    return dateDifference || a.id.localeCompare(b.id)
  })

  const historyDelta = entries.reduce((sum, entry) => sum + entry.delta, 0)
  const inferredOpening = cents(storedBalance) - historyDelta
  const opening = openingBalance == null ? inferredOpening : cents(openingBalance)
  let running = opening
  const paymentTotals = entries
    .filter((entry) => entry.paymentAmount > 0)
    .reduce((totals, entry) => ({
      received: totals.received + entry.paymentAmount,
      allocated: totals.allocated + Math.max(-entry.delta, 0),
    }), { received: 0, allocated: 0 })

  const lines = entries.map((entry) => {
    running += entry.delta
    return {
      id: entry.id,
      transaction_date: entry.date,
      description: entry.description,
      reference_number: entry.reference_number,
      debit: entry.debit / 100,
      credit: entry.credit / 100,
      running_balance: running / 100,
    }
  })

  if (opening !== 0) {
    lines.unshift({
      id: 'opening',
      transaction_date: entries[0]?.date || null,
      description: openingBalance == null
        ? 'Opening balance brought forward (history incomplete)'
        : `Opening balance brought forward${openingBalanceNote ? ` (${openingBalanceNote})` : ''}`,
      reference_number: '',
      debit: opening > 0 ? opening / 100 : 0,
      credit: opening < 0 ? -opening / 100 : 0,
      running_balance: opening / 100,
    })
  }

  return {
    lines,
    totals: {
      charges: (Math.max(opening, 0) + entries.reduce((sum, entry) => sum + entry.debit, 0)) / 100,
      payments: paymentTotals.received / 100,
      allocated: paymentTotals.allocated / 100,
      unallocated: Math.max(paymentTotals.received - paymentTotals.allocated, 0) / 100,
      inferredOpeningBalance: inferredOpening / 100,
      openingBalance: opening / 100,
      openingBalanceNote,
    },
  }
}
