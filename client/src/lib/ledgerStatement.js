// Database money arrives as NUMERIC decimal strings. All arithmetic here is in
// integer centavos; convert to pesos only at the presentation boundary.
export const ledgerCentavos = (value, optional = false) => {
  if (value === null || value === undefined) {
    if (optional) return 0
    throw new Error('Missing required ledger monetary value.')
  }

  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim())
  if (!match) {
    throw new Error('Invalid ledger monetary value. Expected pesos with at most two decimal places.')
  }

  const whole = Number(match[2])
  const fraction = Number((match[3] || '').padEnd(2, '0'))
  const absolute = whole * 100 + fraction

  if (!Number.isSafeInteger(absolute)) {
    throw new Error('Ledger monetary value exceeds the supported range.')
  }

  return match[1] === '-' ? -absolute : absolute
}

const cents = ledgerCentavos
const toAmount = (value) => value / 100
const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase()
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric',
})
const monthFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'long',
})
const money = (value) => peso.format(toAmount(value))
const uuidPattern = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi

export function readableLedgerText(value) {
  return String(value ?? '')
    .replace(/\b(?:record|property|payment|charge|source|balance entry)[_ ]id\s*[:=]?\s*\d+\b/gi, '')
    .replace(uuidPattern, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:;,–—]+|[\s:;,–—]+$/g, '')
}

function ledgerDate(value, formatter = dateFormat) {
  if (!value) return ''
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+08:00` : value)
  return Number.isFinite(date.getTime()) ? formatter.format(date) : ''
}

function chargeCopy(charge) {
  const description = readableLedgerText(charge.description)
  const billingMonth = ledgerDate(charge.billing_month, monthFormat)
  const penalty = /^(?:Annual compound penalty (\d+)|Year (\d+) late penalty): (\d+(?:\.\d+)?)% of (?:PHP |₱)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?) unpaid/i.exec(description)
  if (penalty) {
    const [, cycle, year, rate, base] = penalty
    const anniversary = /anniversary (\d{4}-\d{2}-\d{2})/i.exec(description)
    const anniversaryDate = ledgerDate(anniversary?.[1])
    return {
      title: 'Annual late-payment penalty',
      details: [
        `The system added the year ${cycle || year} penalty at ${Number(rate)}% of the unpaid balance of ₱${base}.`,
        ...(anniversaryDate ? [`Balance anniversary: ${anniversaryDate}.`] : []),
      ],
    }
  }
  const category = readableLedgerText(charge.charge_type)
  if (billingMonth && normalizeStatus(category) === 'association dues') {
    return { title: `Association dues for ${billingMonth}`, details: [description || 'The monthly association dues for this lot were added to the balance.'] }
  }
  return {
    title: category === 'Penalty / Late Fee' ? 'Late-payment penalty' : category || 'Charge added',
    details: [description && description !== category ? description : 'This charge increased the amount owed for this lot.'],
  }
}

function chargeEntries(charge) {
  const amount = Math.max(cents(charge.amount), 0)
  const voided = Boolean(charge.voided_at)
  const { title, details } = chargeCopy(charge)
  const due = ledgerDate(charge.due_date)
  return [{
    id: `charge-${charge.id}`,
    groupId: `charge-${charge.id}`,
    order: 0,
    kind: 'charge',
    date: charge.created_at,
    description: title,
    reference_number: '',
    details: [...details, ...(due ? [`Final due date: ${due}. Any unpaid amount becomes overdue the following day.`] : [])],
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

function enteredBalanceEntries(entry) {
  const amount = cents(entry.amount)
  if (amount <= 0) throw new Error('The entered balance is invalid.')
  const voided = Boolean(entry.voided_at)
  const id = `entered-balance-${entry.id}`
  const asOf = ledgerDate(entry.as_of_date)
  const category = readableLedgerText(entry.category)
  const description = readableLedgerText(entry.description)
  return [{
    id, groupId: id, order: 0, kind: 'entered-balance',
    date: entry.created_at,
    description: 'Earlier balance entered',
    reference_number: '',
    details: [
      `The office added an earlier amount owed${category ? ` for ${category.toLowerCase()}` : ''} on the date shown.`,
      ...(asOf ? [`The earlier balance was reported as of ${asOf}.`] : []),
      ...(description ? [description] : []),
    ],
    debit: voided ? 0 : amount, credit: 0, delta: voided ? 0 : amount, voided,
    paymentAmount: 0, paymentEffect: 0, cashEffect: 0, explicitAllocated: 0,
  }]
}

function paymentEntries(payment, chargesById) {
  const voided = ['voided', 'cancelled', 'canceled'].includes(normalizeStatus(payment.status))
  const paid = Math.max(cents(payment.amount_paid ?? payment.amount), 0)
  const originalEffect = Math.max(cents(payment.balance_effect ?? payment.amount_paid ?? payment.amount), 0)
  const released = Math.min(Math.max(cents(payment.effect_released, true), 0), originalEffect)
  const effective = originalEffect - released
  const allocations = Array.isArray(payment.allocations) ? payment.allocations : []
  const explicitAllocated = voided ? 0 : allocations.reduce((sum, allocation) => sum + Math.max(cents(allocation.allocated_amount), 0), 0)
  const annual = payment.receipt_breakdown?.annual_advance_discount
  // A difference alone is not proof of a promotion. Require the receipt's
  // saved 12-month metadata and exact agreement with the recorded amounts.
  const discount = Math.max(cents(annual?.discount_amount, true), 0)
  const validAnnual = Number(annual?.months_covered) === 12 && discount > 0 &&
    cents(annual?.gross_amount, true) === originalEffect && paid + discount === originalEffect
  const extra = Math.max(originalEffect - paid, 0)
  const unapplied = Math.max(paid - originalEffect, 0)
  const reference = readableLedgerText(payment.receipt_number) || readableLedgerText(payment.reference_number)
  const receivedOn = ledgerDate(payment.paid_at)
  const recordedOn = ledgerDate(payment.created_at)
  const coverage = readableLedgerText(payment.coverage_period) || readableLedgerText(payment.description) || readableLedgerText(payment.charge_type)
  const method = readableLedgerText(payment.payment_method)
  const bankReference = readableLedgerText(payment.reference_number)
  const recorder = readableLedgerText(payment.recorded_by_name)
  const note = readableLedgerText(payment.note)
  const details = [
    `The association received ${money(paid)}. ${money(Math.min(paid, originalEffect))} was originally applied to this lot’s balance.`,
    ...(coverage ? [`What the payment covered: ${coverage}`] : []),
    ...(receivedOn && recordedOn && receivedOn !== recordedOn ? [`Payment received on ${receivedOn}.`] : []),
    ...(method ? [`Payment method: ${method}`] : []),
    ...(bankReference ? [`Payment reference: ${bankReference}`] : []),
    ...(recorder ? [`Recorded by: ${recorder}`] : []),
    ...(note ? [`Note: ${note}`] : []),
    ...(unapplied ? [`${money(unapplied)} of this receipt did not reduce this lot’s balance.`] : []),
  ]
  for (const allocation of allocations) {
    const charge = chargesById.get(allocation.property_charge_id)
    const amount = cents(allocation.allocated_amount)
    if (charge && !charge.voided_at && amount > 0) {
      details.push(`Saved allocation: ${money(amount)} toward ${chargeCopy(charge).title}.`)
    }
  }
  if (validAnnual) details.push(`12 months of dues at a regular price of ${money(originalEffect)}. The association collected ${money(paid)} and gave ${money(discount)} off for one free month.`)
  const groupId = `payment-${payment.id}`
  const base = {
    groupId,
    date: payment.created_at || payment.paid_at,
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
    description: 'Payment received',
    details,
    debit: 0,
    credit: voided ? 0 : paid - unapplied,
    delta: voided ? 0 : unapplied - paid,
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
    description: validAnnual ? 'One-month discount for paying a year ahead' : 'Additional reduction recorded with the payment',
    details: [validAnnual
      ? `The one-month discount reduced the amount owed by ${money(extra)} without a cash payment.`
      : `The receipt reduced the amount owed by an additional ${money(extra)}. The saved receipt gives no reason for the additional reduction.`],
    debit: 0,
    credit: voided ? 0 : extra,
    delta: voided ? 0 : -extra,
  })
  if (released > 0) rows.push({
    ...base,
    id: `${groupId}-effect-adjustment`,
    order: 2,
    kind: 'payment-adjustment',
    description: 'Amount added back after a payment',
    details: [`The saved receipt shows that ${money(released)} of an earlier reduction was added back. The date of that change is unavailable, so this appears beside its receipt.`],
    debit: voided ? 0 : released,
    credit: 0,
    delta: voided ? 0 : released,
  })
  return rows
}

const adjustmentTitles = {
  credit: 'Account credit granted',
  waiver: 'Amount owed waived',
  write_off: 'Uncollectible amount written off',
  refund: 'Refund adjustment',
  debit_correction: 'Correction that increases the balance',
  credit_correction: 'Correction that reduces the balance',
  reversal: 'Earlier adjustment reversed',
}

function adjustmentEntries(adjustment) {
  const reversed = Boolean(adjustment.reversed_at)
  const effect = cents(adjustment.balance_effect)
  const reason = readableLedgerText(adjustment.reason)
  return [{
    id: `adjustment-${adjustment.id}`,
    groupId: `adjustment-${adjustment.id}`,
    order: 0,
    kind: 'account-adjustment',
    date: adjustment.created_at,
    description: adjustmentTitles[adjustment.adjustment_type] || 'Balance correction',
    reference_number: readableLedgerText(adjustment.approval_reference),
    details: [
      `This adjustment ${effect > 0 ? 'increased' : 'reduced'} the lot’s balance by ${money(Math.abs(effect))}.`,
      reason ? `Reason: ${reason}` : 'The reason was not recorded.',
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
  return a.groupId.localeCompare(b.groupId) || a.order - b.order
}

export function buildLedgerStatement({ payments = [], charges = [], adjustments = [], balanceEntries = [], storedBalance = 0, openingBalance = null, openingBalanceNote = '', openingBalanceAsOf = null }) {
  const entered = balanceEntries.flatMap(enteredBalanceEntries)
  const enteredTotal = entered.reduce((sum, entry) => sum + entry.debit, 0)
  const chargesById = new Map(charges.map(charge => [charge.id, charge]))
  const entries = [
    ...entered, ...charges.flatMap(chargeEntries),
    ...payments.flatMap(payment => paymentEntries(payment, chargesById)),
    ...adjustments.flatMap(adjustmentEntries),
  ].sort(compareEntries)
  const historyDelta = entries.reduce((sum, entry) => sum + entry.delta, 0)
  const storedBalanceCents = cents(storedBalance)
  const inferredOpening = storedBalanceCents - historyDelta
  const hasExplicitOpening = openingBalance != null
  const opening = hasExplicitOpening ? cents(openingBalance) - enteredTotal : inferredOpening
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
  const openingAsOf = !enteredTotal && ledgerDate(openingBalanceAsOf)
  const openingNote = !enteredTotal && readableLedgerText(openingBalanceNote)
  if (opening !== 0) lines.push({
    id: 'opening',
    kind: 'opening',
    transaction_date: null,
    description: hasExplicitOpening ? 'Starting balance' : 'Starting balance (some older records are missing)',
    details: [
      opening > 0 ? 'Amount owed before the entries shown below.' : 'Credit available before the entries shown below.',
      ...(openingAsOf ? [`The starting balance was reported as of ${openingAsOf}.`] : []),
      ...(openingNote ? [openingNote] : []),
    ],
    reference_number: '',
    debit: toAmount(Math.max(opening, 0)),
    credit: toAmount(Math.max(-opening, 0)),
    running_balance: toAmount(opening),
    voided: false,
  })
  for (const entry of entries) {
    if (entry.kind === 'payment') cashAppliedToExistingBalance += Math.min(Math.max(running, 0), entry.cashEffect)
    running += entry.delta
    if (entry.voided || entry.delta === 0) continue
    lines.push({
      id: entry.id,
      kind: entry.kind,
      transaction_date: entry.kind === 'payment-adjustment' ? null : entry.date || null,
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
    charges: toAmount(Math.max(opening, 0) + sums.addedCharges + enteredTotal),
    enteredBalances: toAmount(enteredTotal),
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
    canExport: difference === 0 && (hasExplicitOpening || opening === 0),
  } }
}

// Shared by the on-screen statement and its PDF, so both explain the same totals.
export function ledgerStatementNotes(totals, formatMoney) {
  if (!totals) return []
  const notes = []
  if (totals.openingBalanceWasInferred && totals.openingBalance !== 0) notes.push('The starting balance is inferred from the saved balance and the available entries. This statement is for review and PDF export is unavailable.')
  if (totals.annualDiscountCredit > 0) notes.push(`${formatMoney(totals.annualDiscountCredit)} is the discount for one free month when paying 12 months ahead. It lowers your balance but is not part of the money received.`)
  if (totals.additionalRecordedCredit > 0) notes.push(`${formatMoney(totals.additionalRecordedCredit)} was deducted from your balance in addition to your payment. The saved receipt does not explain this deduction. Please ask the office to check it.`)
  if (totals.documentedAccountAdjustments) notes.push('Balance corrections are listed with their reasons and approval numbers. They are not payments.')
  if (totals.unallocated > 0) notes.push(`${formatMoney(totals.unallocated)} of the money received did not reduce this lot’s balance. The payments received total includes this amount. The transaction table shows only balance changes.`)
  if (totals.inferredAppliedToExistingBalance > 0) notes.push(`${formatMoney(totals.inferredAppliedToExistingBalance)} of your payments reduced an earlier amount owed. The saved records do not show which individual bills were paid.`)
  if (totals.payments > 0 && totals.explicitlyAllocated === 0) notes.push('No individual bill-to-payment allocations are recorded for this lot. The statement shows recorded balance effects, not verification of which specific bills were paid.')
  if (totals.explicitlyAllocated > 0) notes.push(`The records show which bills were paid by ${formatMoney(totals.explicitlyAllocated)} of your payments.`)
  if (totals.availableCredit > 0) notes.push(`${formatMoney(totals.availableCredit)} is available for future bills on this lot. This may include advance payments and discounts. It is not an amount you owe.`)
  if (!totals.reconcilesWithStoredBalance) notes.push(`The final balance shown here differs from the saved lot balance by ${formatMoney(totals.reconciliationDifference)}. The saved balance is ${formatMoney(totals.storedBalance)}. Please ask the office to check the records.`)
  return notes
}
