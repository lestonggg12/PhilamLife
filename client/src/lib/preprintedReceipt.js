export const RECEIPT_PAPER = Object.freeze({ width: 139.7, height: 215.9 })

// All printed money is derived from saved values using integer centavos.
function cents(value) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value ?? 0).trim())
  if (!match) return 0n
  const fraction = (match[2] || '').padEnd(3, '0')
  return BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1n : 0n)
}
const amount = (value) => `${(value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(value % 100n).toString().padStart(2, '0')}`

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
  const total = validAnnual ? gross : paid
  let quantity = validAnnual ? '12' : '1'
  let unitPrice = validAnnual && gross % 12n === 0n ? amount(gross / 12n) : validAnnual ? '' : amount(paid)
  const serviceDue = cents(row.amount_due)
  const serviceQuantity = String(row.quantity ?? '')
  const quantityParts = /^(\d+)(?:\.(\d+))?$/.exec(serviceQuantity)
  if (kind === 'service' && serviceDue === paid && quantityParts) {
    const fraction = quantityParts[2] || ''
    const divisor = BigInt(quantityParts[1] + fraction)
    if (divisor > 0n) {
      quantity = serviceQuantity.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
      const numerator = paid * (10n ** BigInt(fraction.length))
      unitPrice = numerator % divisor === 0n ? amount(numerator / divisor) : ''
    }
  }
  if (unitPrice.length > 10) unitPrice = ''
  const partial = kind === 'service' && serviceDue > paid
  const description = kind === 'service'
    ? `${partial ? 'Part payment - ' : ''}${row.service_name || 'Village service'}${row.balance_of ? ' - balance payment' : ''}`
    : row.coverage_period || row.charge_type || 'Homeowner payment'
  const date = row.paid_at || row.created_at
  const parsedDate = date ? new Date(date) : null
  const issuedDate = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsedDate) : ''
  return {
    name: kind === 'service' ? row.customer_name || 'Unnamed customer' : row.homeowner_name || 'Unnamed homeowner',
    lot: [row.block_name, row.lot_number ? `Lot ${row.lot_number}` : ''].filter(Boolean).join(', '),
    date: issuedDate, description, quantity, unitPrice,
    lineAmount: amount(total), totalSales: amount(total), discount: validAnnual ? amount(discount) : '',
    totalPaid: amount(paid), issuedBy: row.recorded_by_name || '',
    method: [row.payment_method, row.reference_number].filter(Boolean).join(' / '),
  }
}

export function preprintedLayoutError(fields) {
  if (!fields) return 'The saved receipt details are unavailable.'
  if (String(fields.quantity).length > 5) return 'The saved quantity is too wide for the form. Ask the office to review it before printing.'
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

export function readPrintAlignment() {
  try {
    const saved = JSON.parse(localStorage.getItem('philamlife-receipt-alignment-v1') || '{}')
    return { x: alignmentValue(saved.x), y: alignmentValue(saved.y) }
  } catch { return { x: 0, y: 0 } }
}
export function alignmentValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(-5, Math.min(5, number)) : 0
}
