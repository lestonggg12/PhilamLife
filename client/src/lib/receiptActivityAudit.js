import { supabase } from './supabaseClient'

// The server resolves the authenticated staff actor; never accept a user ID from the browser.
// A print request event does not assert that printing finished.
export async function recordReceiptActivity(action, { kind, receiptNumber, recordId }) {
  if (!['Receipt Viewed', 'Receipt Print Requested'].includes(action)) {
    throw new Error('Unknown receipt audit event.')
  }
  const type = kind === 'service' ? 'Service' : kind === 'payment' ? 'Regular' : null
  const id = String(recordId ?? '').trim()
  if (!type || !/^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(id)) {
    throw new Error('Receipt audit requires a verified source record.')
  }
  // Avoid copying names, balances, addresses, or payment notes into audit descriptions.
  const number = String(receiptNumber || 'number unavailable').slice(0, 80).replace(/[\r\n]/g, ' ')
  const { error } = await supabase.rpc('write_audit_log', {
    p_action: action,
    p_target: `${type} receipt ${number} — Record ID ${id}`,
  })
  if (error) throw error
}
