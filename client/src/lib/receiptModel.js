// Turns a saved payment or service-transaction row into the plain "receipt
// model" that ReceiptSheet draws. Every receipt in the app (Record Payment,
// Services Management, Official Receipts) goes through here, so a receipt
// reads the same wherever it is opened or printed.

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
const SCALES = ['', ' Thousand', ' Million', ' Billion', ' Trillion']

function belowThousand(n) {
  const parts = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest) {
    if (rest < 20) parts.push(ONES[rest])
    else parts.push(rest % 10 ? `${TENS[Math.floor(rest / 10)]}-${ONES[rest % 10]}` : TENS[Math.floor(rest / 10)])
  }
  return parts.join(' ')
}

/**
 * 1234.5 -> "One Thousand Two Hundred Thirty-Four Pesos and 50/100 Only"
 * Whole amounts omit the centavos: 500 -> "Five Hundred Pesos Only".
 */
export function amountInWords(value) {
  // Work in whole centavos so decimals can never drift.
  const totalCents = Math.round(Math.abs(Number(value) || 0) * 100)
  const pesos = Math.floor(totalCents / 100)
  const centavos = totalCents % 100

  let words
  if (pesos === 0) {
    words = 'Zero'
  } else {
    const groups = []
    let remaining = pesos
    let scale = 0
    while (remaining > 0) {
      const chunk = remaining % 1000
      if (chunk) groups.unshift(`${belowThousand(chunk)}${SCALES[scale] ?? ''}`)
      remaining = Math.floor(remaining / 1000)
      scale += 1
    }
    words = groups.join(' ')
  }

  const unit = pesos === 1 ? 'Peso' : 'Pesos'
  const cents = centavos ? ` and ${String(centavos).padStart(2, '0')}/100` : ''
  return `${words} ${unit}${cents} Only`
}

// "Block 3" + "12" -> "Block 3, Lot 12" (a lot already written as "Lot 12" is left alone).
function propertyLabel(blockName, lotNumber) {
  const lot = lotNumber
    ? /^lot\s/i.test(String(lotNumber)) ? String(lotNumber) : `Lot ${lotNumber}`
    : ''
  return [blockName, lot].filter(Boolean).join(', ') || 'Not specified'
}

const num = (value) => Number(value) || 0

/**
 * @param {'payment'|'service'} kind
 * @param {object} row - the payments / service_transactions row
 * @param {object} organization - from useOrganization(): associationName, address,
 *   contactPhone, contactEmail, formatMoney(), formatDate()
 * @param {object} [options]
 * @param {string} [options.advanceNote] - extra note explaining an advance-credit balance
 */
export function buildReceiptModel(kind, row, organization, { advanceNote = '' } = {}) {
  const money = (value) => organization.formatMoney(value)
  const dateTime = (value) => organization.formatDate(value, { withTime: true })
  const dateOnly = (yyyyMmDd) => (yyyyMmDd ? organization.formatDate(`${yyyyMmDd}T12:00:00+08:00`) : '—')

  const common = {
    organization: {
      name: organization.associationName,
      address: organization.address || '',
      contact: [organization.contactPhone, organization.contactEmail].filter(Boolean).join('  |  '),
    },
    receiptNumber: row.receipt_number || 'Receipt number unavailable',
    issuedAt: dateTime(row.paid_at),
    issuedBy: row.recorded_by_name || '—',
  }

  if (kind === 'service') {
    const paid = num(row.amount_paid)
    const due = num(row.amount_due)
    const status = String(row.payment_status || 'paid').toLowerCase()
    const voided = status === 'voided'
    const partial = status === 'partial'

    const meta = [`Service date: ${dateOnly(row.service_date)}`]
    if (row.start_time) meta.push(`Start time: ${String(row.start_time).slice(0, 5)}`)
    if (row.quantity && Number(row.quantity) !== 1) meta.push(`Quantity: ${row.quantity}`)

    const summary = []
    if (due) summary.push({ label: 'Amount due', value: money(due) })
    summary.push({ label: 'Amount paid', value: money(paid), strong: true })
    if (partial && due > paid) summary.push({ label: 'Balance remaining', value: money(due - paid) })

    return {
      ...common,
      kind,
      title: 'Official Receipt',
      subtitle: 'Amenity and Service Payment',
      voided,
      voidReason: '',
      statusLabel: partial ? 'Partial payment' : voided ? 'Voided' : 'Paid',
      details: [
        { label: 'Received from', value: row.customer_name || 'Unnamed customer' },
        { label: 'Property', value: propertyLabel(row.block_name, row.lot_number) },
        { label: 'Payment method', value: row.payment_method || 'Not specified' },
        { label: 'Reference no.', value: row.reference_number || '' },
      ].filter((d) => d.value),
      lines: [{ description: row.service_name || 'Village service', meta: meta.join('   |   '), amount: money(paid) }],
      summary,
      amountInWords: amountInWords(paid),
      notes: row.notes ? [{ label: 'Notes', text: row.notes }] : [],
    }
  }

  // Homeowner payment
  const paid = num(row.amount_paid ?? row.amount)
  const previous = num(row.previous_balance)
  const remaining = num(row.remaining_balance)
  const voided = row.status === 'Voided'

  const notes = []
  if (advanceNote) notes.push({ label: 'Advance credit', text: advanceNote })
  if (row.note) notes.push({ label: 'Note', text: row.note })

  return {
    ...common,
    kind,
    title: 'Official Receipt',
    subtitle: 'Homeowner Payment',
    voided,
    voidReason: voided ? row.void_reason || '' : '',
    statusLabel: voided ? 'Voided' : 'Paid',
    details: [
      { label: 'Received from', value: row.homeowner_name || 'Unnamed homeowner' },
      { label: 'Property', value: propertyLabel(row.block_name, row.lot_number) },
      { label: 'Payment method', value: row.payment_method || 'Not specified' },
      { label: 'Reference no.', value: row.reference_number || '' },
    ].filter((d) => d.value),
    lines: [{ description: row.coverage_period || 'Homeowner payment', meta: '', amount: money(paid) }],
    summary: [
      { label: previous < 0 ? 'Previous advance credit' : 'Previous balance', value: money(Math.abs(previous)) },
      { label: 'Amount paid', value: money(paid), strong: true },
      { label: remaining < 0 ? 'Advance credit' : 'Remaining balance', value: money(Math.abs(remaining)) },
    ],
    amountInWords: amountInWords(paid),
    notes,
  }
}
