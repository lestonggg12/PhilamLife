import { supabase } from './supabaseClient'

export async function recordReceiptActivity(
  action,
  { kind, recordId },
) {
  if (!['Receipt Viewed', 'Receipt Print Requested'].includes(action)) {
    throw new Error('Unknown receipt audit event.')
  }

  if (!['payment', 'service'].includes(kind)) {
    throw new Error('Invalid receipt kind.')
  }

  const id = String(recordId ?? '').trim()

  if (!id) {
    throw new Error('Receipt audit requires a verified source record.')
  }

  const { error } = await supabase.rpc('record_receipt_activity', {
    p_action: action,
    p_kind: kind,
    p_record_id: id,
  })

  if (error) throw error
}