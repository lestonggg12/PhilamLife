function offset(value) {
  const text = String(value ?? '').trim()
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter both offsets with at most two decimal places.')
  const number = Number(text)
  if (!Number.isFinite(number) || number < -5 || number > 5) throw new Error('Alignment must be between -5 and 5 mm.')
  return number
}
export function receiptAlignmentOffsets(value) {
  if (!value) throw new Error('Load the shared printer alignment before printing.')
  return { x: offset(value.x), y: offset(value.y) }
}
function snapshot(row) {
  const alignment = receiptAlignmentOffsets(row && { x: row.x_mm, y: row.y_mm })
  const revision = Number(row?.revision)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('The saved printer alignment is invalid. Reload it before printing.')
  return { ...alignment, revision }
}
export async function loadReceiptAlignment(client) {
  const { data, error } = await client.from('receipt_print_settings').select('x_mm, y_mm, revision').eq('id', 1).single()
  if (error) throw error
  return snapshot(data)
}
export async function saveReceiptAlignment(client, draft, expectedRevision) {
  const alignment = receiptAlignmentOffsets(draft)
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Reload the saved alignment before saving.')
  const { data, error } = await client.rpc('save_receipt_print_alignment', {
    p_x_mm: alignment.x, p_y_mm: alignment.y, p_expected_revision: expectedRevision,
  }).single()
  if (error) throw error
  return snapshot(data)
}
