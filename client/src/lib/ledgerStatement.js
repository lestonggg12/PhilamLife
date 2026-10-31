// Database money arrives as NUMERIC decimal strings. All arithmetic here is in
// integer centavos; convert to pesos only at the presentation boundary.
const cents = (value) => {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? 0).trim())
  if (!match) return 0
  const fraction = (match[3] || '').padEnd(3, '0')
  const absolute = Number(match[2]) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0)
  return match[1] === '-' ? -absolute : absolute
}
const toAmount = (value) => value / 100
const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase()
const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(toAmount(value))

function chargeEntries(charge) {
  const amount = Math.max(cents(charge.amount), 0)
  const voided = Boolean(charge.voided_at)
  return [{
    id: `charge-${charge.id}`,
    groupId: `charge-${charge.id}`,
    order: 0,
    kind: 'charge',
    date: charge.voided_at || charge.created_at,
    description: `${charge.description || charge.charge_type || 'Charge'}${voided ? ' (Voided)' : ''}`,
    reference_number: charge.billing_month ? String(charge.billing_month).slice(0, 7) : '',
    details: voided
      ? [`Original charge ${money(amount)}; excluded from totals and running balance.`, ...(charge.void_reason ? [`Void reason: ${charge.void_reason}`] : [])]
      : [],
    debit: voided ? 0 : amount,
    credit: 0,
    voided,
    delta: voided ? 0 : amount,
    paymentAmount: 0,
    paymentEffect: 0,
    cashEffect: 0,
    explicitAllocated: 0,
  }]
}

function paymentEntries(payment) {
  const voided = normalizeStatus(payment.status) === 'voided'
  const paid = Math.max(cents(payment.amount_paid ?? payment.amount), 0)
  const originalEffect = Math.max(cents(payment.balance_effect ?? payment.amount_paid ?? payment.amount), 0)
  const released = Math.min(Math.max(cents(payment.effect_released), 0), originalEffect)
  const effective = originalEffect - released
  const allocations = Array.isArray(payment.allocations) ? payment.allocations : []
  const explicitAllocated = voided ? 0 : allocations.reduce((sum, allocation) => sum + Math.max(cents(allocation.allocated_amount), 0), 0)
  const annual = payment.receipt_breakdown?.annual_advance_discount
  // A difference alone is not proof of a promotion. Require the receipt's
  // saved 12-month metadata and exact agreement with the recorded amounts.
  const discount = Math.max(cents(annual?.discount_amount), 0)
  const validAnnual = Number(annual?.months_covered) === 12 && discount > 0 &&
    cents(annual?.gross_amount) === originalEffect && paid + discount === originalEffect
  const extra = Math.max(originalEffect - paid, 0)
  const unapplied = Math.max(paid - originalEffect, 0)
  const reference = payment.receipt_number || payment.reference_number || ''
  const details = [
    ...(payment.payment_method ? [`Payment method: ${payment.payment_method}`] : []),
    ...(payment.reference_number ? [`Payment reference: ${payment.reference_number}`] : []),
    ...(payment.recorded_by_name ? [`Recorded by: ${payment.recorded_by_name}`] : []),
    ...(payment.note ? [`Note: ${payment.note}`] : []),
  ]
  if (validAnnual) details.push(`12 months of dues: ${money(originalEffect)} regular price; ${money(paid)} collected; ${money(discount)} one-month-free credit.`)
  if (voided) details.push(`Original payment ${money(paid)}; excluded from totals and running balance.`, ...(payment.void_reason ? [`Void reason: ${payment.void_reason}`] : []))
  const groupId = `payment-${payment.id}`
  const base = {
    groupId,
    date: payment.paid_at || payment.created_at,
    reference_number: reference,
    voided,
    paymentAmount: 0,
    paymentEffect: 0,
    cashEffect: 0,
    explicitAllocated: 0,
    details: [],
  }
  const rows = [{
    ...base,
    id: groupId,
    order: 0,
    kind: 'payment',
    description: `${payment.coverage_period || payment.description || 'Payment'}${voided ? ' (Voided)' : ''}`,
    details,
    debit: 0,
    credit: voided ? 0 : paid,
    delta: voided ? 0 : -paid,
    paymentAmount: voided ? 0 : paid,
    paymentEffect: voided ? 0 : effective,
    cashEffect: voided ? 0 : Math.min(paid, effective),
    explicitAllocated,
  }]
  // Split the actual cash and every non-cash effect. Each active row now obeys
  // previous balance + debit - credit = running balance.
  if (extra > 0) rows.push({
    ...base,
    id: `${groupId}-noncash`,
    order: 1,
    kind: validAnnual ? 'annual-discount' : 'recorded-credit',
    description: `${validAnnual ? 'Annual advance discount - 1 month free (non-cash)' : 'Additional recorded balance credit (non-cash)'}${voided ? ' (Voided)' : ''}`,
    details: [voided ? `Original non-cash credit ${money(extra)}; excluded from totals and running balance.` : 'Reduces the account balance; not money collected.'],
    debit: 0,
    credit: voided ? 0 : extra,
    delta: voided ? 0 : -extra,
  })
  if (unapplied + released > 0) rows.push({
    ...base,
    id: `${groupId}-effect-adjustment`,
    order: 2,
    kind: 'payment-adjustment',
    description: `Payment balance-effect adjustment${voided ? ' (Voided)' : ''}`,
    details: [
      ...(unapplied ? [`${money(unapplied)} of the received amount was not applied to this account balance.`] : []),
      ...(released ? [`${money(released)} of the original balance reduction was released.`] : []),
      ...(voided ? ['Excluded from totals and running balance.'] : []),
    ],
    debit: voided ? 0 : unapplied + released,
    credit: 0,
    delta: voided ? 0 : unapplied + released,
  })
  return rows
}

function adjustmentEntries(adjustment) {
  const reversed = Boolean(adjustment.reversed_at)
  const effect = cents(adjustment.balance_effect)
  return [{
    id: `adjustment-${adjustment.id}`,
    groupId: `adjustment-${adjustment.id}`,
    order: 0,
    kind: 'account-adjustment',
    date: adjustment.created_at,
    description: `Documented account adjustment${reversed ? ' (Reversed)' : ''}`,
    reference_number: adjustment.approval_reference || '',
    details: [
      adjustment.reason || adjustment.adjustment_type || 'Recorded account correction',
      'Non-cash adjustment; not a payment received.',
      ...(reversed ? [`Reversed ${String(adjustment.reversed_at).slice(0, 10)}; excluded from totals.`, ...(adjustment.reversal_reason ? [adjustment.reversal_reason] : [])] : []),
    ],
    voided: reversed,
    debit: reversed ? 0 : Math.max(effect, 0),
    credit: reversed ? 0 : Math.max(-effect, 0),
    delta: reversed ? 0 : effect,
    paymentAmount: 0,
    paymentEffect: 0,
    cashEffect: 0,
    explicitAllocated: 0,
  }]
}

function compareEntries(a, b) {
  const stamp = (value) => {
    const time = value ? new Date(value).getTime() : 0
    return Number.isFinite(time) ? time : 0
  }
  const timeDifference = stamp(a.date) - stamp(b.date)
  if (timeDifference) return timeDifference
  const aVoidedCharge = a.kind === 'charge' && a.voided
  const bVoidedCharge = b.kind === 'charge' && b.voided
  if (aVoidedCharge !== bVoidedCharge) return aVoidedCharge ? 1 : -1
  return a.groupId.localeCompare(b.groupId) || a.order - b.order
}

export function buildLedgerStatement({ payments = [], charges = [], adjustments = [], storedBalance = 0, openingBalance = null, openingBalanceNote = '', openingBalanceAsOf = null }) {
  const entries = [...charges.flatMap(chargeEntries), ...payments.flatMap(paymentEntries), ...adjustments.flatMap(adjustmentEntries)].sort(compareEntries)
  const historyDelta = entries.reduce((sum, entry) => sum + entry.delta, 0)
  const storedBalanceCents = cents(storedBalance)
  const inferredOpening = storedBalanceCents - historyDelta
  const hasExplicitOpening = openingBalance != null
  const opening = hasExplicitOpening ? cents(openingBalance) : inferredOpening
  const sums = entries.reduce((totals, entry) => ({
    received: totals.received + entry.paymentAmount,
    appliedEffect: totals.appliedEffect + entry.paymentEffect,
    cashEffect: totals.cashEffect + entry.cashEffect,
    explicit: totals.explicit + entry.explicitAllocated,
    addedCharges: totals.addedCharges + (entry.kind === 'charge' ? entry.debit : 0),
    annualDiscount: totals.annualDiscount + (entry.kind === 'annual-discount' ? entry.credit : 0),
    recordedCredit: totals.recordedCredit + (entry.kind === 'recorded-credit' ? entry.credit : 0),
    effectAdjustments: totals.effectAdjustments + (entry.kind === 'payment-adjustment' ? entry.debit : 0),
    accountAdjustments: totals.accountAdjustments + (entry.kind === 'account-adjustment' ? entry.delta : 0),
  }), { received: 0, appliedEffect: 0, cashEffect: 0, explicit: 0, addedCharges: 0, annualDiscount: 0, recordedCredit: 0, effectAdjustments: 0, accountAdjustments: 0 })

  const lines = []
  let running = opening
  let cashAppliedToExistingBalance = 0
  if (opening !== 0) lines.push({
    id: 'opening',
    kind: 'opening',
    transaction_date: openingBalanceAsOf || null,
    description: hasExplicitOpening ? 'Opening balance brought forward' : 'Opening balance brought forward (history incomplete)',
    details: openingBalanceNote ? [openingBalanceNote] : [],
    reference_number: '',
    debit: toAmount(Math.max(opening, 0)),
    credit: toAmount(Math.max(-opening, 0)),
    running_balance: toAmount(opening),
    voided: false,
  })
  for (const entry of entries) {
    if (entry.kind === 'payment') cashAppliedToExistingBalance += Math.min(Math.max(running, 0), entry.cashEffect)
    running += entry.delta
    lines.push({
      id: entry.id,
      kind: entry.kind,
      transaction_date: entry.date || null,
      description: entry.description,
      details: entry.details,
      reference_number: entry.reference_number,
      debit: toAmount(entry.debit),
      credit: toAmount(entry.credit),
      running_balance: toAmount(running),
      voided: entry.voided,
    })
  }
  const difference = running - storedBalanceCents
  return { lines, totals: {
    finalBalance: toAmount(running),
    outstandingBalance: toAmount(Math.max(running, 0)),
    availableCredit: toAmount(Math.max(-running, 0)),
    charges: toAmount(Math.max(opening, 0) + sums.addedCharges),
    addedCharges: toAmount(sums.addedCharges),
    totalDebits: toAmount(Math.max(opening, 0) + entries.reduce((sum, entry) => sum + entry.debit, 0)),
    totalCredits: toAmount(Math.max(-opening, 0) + entries.reduce((sum, entry) => sum + entry.credit, 0)),
    chargeReversals: toAmount(entries.reduce((sum, entry) => sum + entry.credit, 0)),
    payments: toAmount(sums.received),
    annualDiscountCredit: toAmount(sums.annualDiscount),
    additionalRecordedCredit: toAmount(sums.recordedCredit),
    paymentEffectAdjustments: toAmount(sums.effectAdjustments),
    documentedAccountAdjustments: toAmount(sums.accountAdjustments),
    netOtherAdjustments: toAmount(sums.effectAdjustments + sums.accountAdjustments - sums.recordedCredit),
    allocated: toAmount(sums.appliedEffect),
    explicitlyAllocated: toAmount(sums.explicit),
    inferredAllocated: toAmount(Math.max(sums.appliedEffect - sums.explicit, 0)),
    // Advance payments for future dues are not treated as unexplained allocations.
    inferredAppliedToExistingBalance: toAmount(Math.max(cashAppliedToExistingBalance - sums.explicit, 0)),
    unallocated: toAmount(Math.max(sums.received - sums.cashEffect, 0)),
    openingBalance: toAmount(opening),
    inferredOpeningBalance: toAmount(inferredOpening),
    openingBalanceWasInferred: !hasExplicitOpening,
    openingBalanceNote,
    storedBalance: toAmount(storedBalanceCents),
    reconciliationDifference: toAmount(difference),
    reconcilesWithStoredBalance: difference === 0,
  } }
}

// Shared by the on-screen statement and its PDF, so both explain the same totals.
export function ledgerStatementNotes(totals, formatMoney) {
  if (!totals) return []
  const notes = []
  if (totals.openingBalanceWasInferred && totals.openingBalance !== 0) notes.push('The opening balance is inferred from the saved lot balance and available history; older transactions may be missing.')
  if (totals.annualDiscountCredit > 0) notes.push(`${formatMoney(totals.annualDiscountCredit)} is annual advance discount credit (1 month free), not cash received. It is included in the account credits but excluded from Payments received.`)
  if (totals.additionalRecordedCredit > 0) notes.push(`${formatMoney(totals.additionalRecordedCredit)} is additional non-cash credit from the saved payment balance effects. No matching annual-discount metadata was available; verify the supporting record.`)
  if (totals.documentedAccountAdjustments) notes.push('Documented account adjustments are included with their approval references and reasons. They change the balance but are not payments received.')
  if (totals.unallocated > 0) notes.push(`${formatMoney(totals.unallocated)} of cash received is not included in the effective account balance reduction. The separate payment adjustment rows explain the recorded difference.`)
  if (totals.inferredAppliedToExistingBalance > 0) notes.push(`${formatMoney(totals.inferredAppliedToExistingBalance)} of cash was applied to an existing positive balance using saved account effects; individual receipt-to-charge links are not available for that portion.`)
  if (totals.explicitlyAllocated > 0) notes.push(`${formatMoney(totals.explicitlyAllocated)} has explicit receipt-to-charge allocation records.`)
  if (totals.availableCredit > 0) notes.push(`Available credit of ${formatMoney(totals.availableCredit)} is carried forward against future charges on this lot. It can include both payments and non-cash credits.`)
  if (!totals.reconcilesWithStoredBalance) notes.push(`Reconciliation difference: ${formatMoney(totals.reconciliationDifference)}. The statement closing balance does not match the saved lot balance of ${formatMoney(totals.storedBalance)}; review the account history.`)
  return notes
}
