// Read-only evidence annotations. They never add ledger rows or change debit,
// credit, running balance, or the verified statement totals.
import { financialAuditDetails } from './financialAuditDetails'

const supported = new Set(['credit_applied', 'monthly_balance_added', 'penalty_applied', 'penalty_collected'])

export function annotateLedgerStatementEvidence(lines, events) {
  const byCharge = new Map()
  const byPayment = new Map()
  for (const event of events || []) {
    if (!supported.has(event?.kind)) continue
    const payload = event.payload || {}
    const chargeId = event.kind === 'penalty_applied' ? payload.charge_id : payload.source_id
    if (event.kind === 'penalty_collected') {
      if (!/^\d+$/.test(String(payload.source_id || ''))) continue
      const key = `payment-${payload.source_id}`
      byPayment.set(key, [...(byPayment.get(key) || []), event])
    } else if (chargeId) {
      const key = `charge-${chargeId}`
      byCharge.set(key, [...(byCharge.get(key) || []), event])
    }
  }
  return (lines || []).map(line => {
    const eventsForLine = line.kind === 'charge' ? byCharge.get(line.id)
      : line.kind === 'payment' ? byPayment.get(line.id) : undefined
    if (!eventsForLine?.length) return line
    const notes = []
    for (const event of eventsForLine) {
      const p = event.payload || {}
      if (event.kind === 'credit_applied') {
        const value = financialAuditDetails(event).find(x => x.startsWith('Advance credit consumed'))
        if (value && !notes.includes(value)) notes.push(`${value}. Applied to this charge; NOT a second payment or deduction.`)
      } else if (event.kind === 'monthly_balance_added') {
        const value = financialAuditDetails(event).find(x => x.startsWith('Unpaid portion added'))
        if (value) notes.push(`${value}. This is part of the monthly charge above, NOT an extra charge.`)
        // Older events may omit credit_applied but carry evidence in this record.
        if (!eventsForLine.some(e => e.kind === 'credit_applied')) {
          const credit = financialAuditDetails(event).find(x => x.startsWith('Advance credit consumed'))
          if (credit) notes.push(`${credit}. NOT an extra payment or deduction.`)
        }
      } else if (event.kind === 'penalty_applied') {
        notes.push(...financialAuditDetails(event).filter(x =>
          x.startsWith('Penalty assessed') || x.startsWith('Eligible unpaid') ||
          x.startsWith('Annual rate') || x.startsWith('Anniversary') ||
          x.startsWith('Annual penalty applies')))
      } else if (event.kind === 'penalty_collected') {
        notes.push(...financialAuditDetails(event).filter(x =>
          x.startsWith('Payment allocated to penalties') || x.startsWith('Targeted penalty charge')))
        notes.push('Penalty allocation is part of this existing receipt, NOT a second collection.')
      }
    }
    return notes.length ? { ...line, details: [...(line.details || []), ...new Set(notes)] } : line
  })
}
