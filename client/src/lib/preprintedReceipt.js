export const RECEIPT_PAPER = Object.freeze({ width: 139.7, height: 215.9 })

// All printed money is derived from saved values using integer centavos.
function cents(value) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? 0).trim())
  if (!match) return 0n
  const fraction = (match[2] || '').padEnd(3, '0')
  return BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1n : 0n)
}
const amount = (value) => `${(value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(value % 100n).toString().padStart(2, '0')}`

export function formatInvoiceQuantity(value) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? '').trim())
  if (!match) return '0.00'

  const fraction = match[2] || ''
  const scale = 10n ** BigInt(fraction.length)
  const numerator = BigInt(match[1] + fraction)
  const rounded = (numerator * 100n + scale / 2n) / scale

  return `${rounded / 100n}.${String(rounded % 100n).padStart(2, '0')}`
}

export function normalizePaperNumber(value) {
  const number = String(value ?? '').trim()
  if (!/^\d{1,20}$/.test(number) || !/[1-9]/.test(number)) throw new Error('Enter the red invoice number on the paper, using 1–20 digits.')
  return number
}

export function wrapReceiptText(value, width = 36) {
  const lines = []
  let line = ''
  for (let word of String(value ?? '').trim().split(/\s+/).filter(Boolean)) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = '' }
    while (word.length > width) {
      lines.push(word.slice(0, width)); word = word.slice(width)
    }
    if (word) line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines
}

export function buildPreprintedFields(kind, row) {
  const paid = cents(row.amount_paid ?? row.amount)
  const annual = kind === 'payment' ? row.receipt_breakdown?.annual_advance_discount : null
  const gross = cents(annual?.gross_amount)
  const discount = cents(annual?.discount_amount)
  const validAnnual = Number(annual?.months_covered) === 12 && discount > 0n && gross === paid + discount
  const manual = kind === 'payment' ? row.manual_discount : null
  const manualDiscount = cents(manual?.discount_amount)
  const manualGross = cents(manual?.gross_amount ?? (Number((row.amount_paid ?? row.amount) || 0) + Number(manual?.discount_amount || 0)))
  const validManual = !validAnnual && manualDiscount > 0n && manualGross === paid + manualDiscount
  // Itemize retained overpayments: a debt discount never applies to advance credit.
  // Older receipts may lack manual_cash_discount metadata; their saved debt and
  // cash amounts still allow an exact reconstruction of a full-balance payment.
  const debtBeforeDiscount = cents(row.previous_balance)
  const debtAdvanceSplit = kind === 'payment' && validManual &&
    debtBeforeDiscount > manualDiscount && paid > debtBeforeDiscount - manualDiscount &&
    row.charge_type !== 'Other'
  const advanceCredit = debtAdvanceSplit ? paid - (debtBeforeDiscount - manualDiscount) : 0n
  // For debt + advance payments, the printed lines already reflect the discount.
  // Do not add the discount back to the cash total and then subtract it again.
  const total = validAnnual ? gross : validManual && !debtAdvanceSplit ? manualGross : paid
  let quantity = validAnnual ? '12' : '1'
  let unitPrice = validAnnual && gross % 12n === 0n ? amount(gross / 12n) : validAnnual ? '' : amount(total)
  const serviceDue = cents(row.amount_due)
  const serviceQuantity = String(row.quantity ?? '')
  const quantityParts = /^(\d+)(?:\.(\d+))?$/.exec(serviceQuantity)
  if (kind === 'service' && !row.balance_of && quantityParts) {
    quantity = formatInvoiceQuantity(serviceQuantity)
    // Displayed quantity may be rounded. Only print a unit price when
    // quantity x unit price EXACTLY equals the saved receipt amount.
    // Otherwise leave it blank rather than display misleading arithmetic.
    const printedQuantityCents = BigInt(quantity.replace('.', ''))
    const numerator = paid * 100n
    unitPrice = serviceDue === paid &&
      printedQuantityCents > 0n &&
      numerator % printedQuantityCents === 0n
      ? amount(numerator / printedQuantityCents)
      : ''
  }
  if (debtAdvanceSplit) unitPrice = amount(debtBeforeDiscount - manualDiscount)
  if (unitPrice.length > 10) unitPrice = ''
  const partial = kind === 'service' && serviceDue > paid
  const description = debtAdvanceSplit ? `Debt after ${amount(manualDiscount)} discount` : kind === 'service'
    ? `${partial ? 'Part payment - ' : ''}${row.service_name || 'Village service'}${row.balance_of ? ' - balance payment' : ''}`
    : row.coverage_period || row.charge_type || 'Homeowner payment'
  const date = row.paid_at || row.created_at
  const parsedDate = date ? new Date(date) : null
  const issuedDate = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsedDate) : ''
  return {
    name: kind === 'service' ? row.customer_name || 'Unnamed customer' : row.homeowner_name || 'Unnamed homeowner',
    lot: [row.block_name, row.lot_number ? `Lot ${row.lot_number}` : ''].filter(Boolean).join(', '),
    date: issuedDate, description: cents(row.receipt_breakdown?.returned_change?.change_amount) > 0n
      ? `${description} / Change returned: ${amount(cents(row.receipt_breakdown.returned_change.change_amount))}`
      : description, quantity, unitPrice,
    lineAmount: amount(debtAdvanceSplit ? debtBeforeDiscount - manualDiscount : total),
    advanceLine: debtAdvanceSplit ? {
      description: 'Advance credit (future dues)', quantity: '1',
      unitPrice: amount(advanceCredit), lineAmount: amount(advanceCredit),
    } : null,
    totalSales: amount(total), discount: validAnnual ? amount(discount) : validManual && !debtAdvanceSplit ? amount(manualDiscount) : '',
    totalPaid: amount(paid), issuedBy: row.recorded_by_name || '',
    method: [row.payment_method, row.reference_number].filter(Boolean).join(' / '),
  }
}

export function preprintedLayoutError(fields) {
  if (!fields) return 'The saved receipt details are unavailable.'
  if (fields.advanceLine && (wrapReceiptText(fields.description).length !== 1 ||
      wrapReceiptText(fields.advanceLine.description).length !== 1)) return 'The payment lines cannot fit on the printed form.'
  if (String(fields.quantity).length > 6) return 'The saved quantity is too wide for the form. Ask the office to review it before printing.'
  if (wrapReceiptText(fields.description).length > 6) return 'This payment description is too long for the six lines on this form. Ask the office to review it before printing; no details have been cut off.'
  if (wrapReceiptText(fields.name, 57).length > 2) return 'The homeowner name is too long for this form. Ask the office to review it before printing.'
  if (wrapReceiptText(fields.method, 59).length > 2) return 'The payment reference is too long for this form. Ask the office to review it before printing.'
  if (wrapReceiptText(fields.lot, 58).length > 1) return 'The block and lot text is too long for the form. Ask the office to review it before printing.'
  if (wrapReceiptText(fields.issuedBy, 26).length > 2) return 'The staff name is too long for the signature area. Ask the office to review it before printing.'
  return ''
}

export function receiptPaperKey(model) {
  if (!model.sourceId || !['payment', 'service'].includes(model.kind)) throw new Error('Open a saved receipt before assigning a paper number.')
  return model.kind === 'payment' ? { payment_id: model.sourceId } : { service_transaction_id: model.sourceId }
}
