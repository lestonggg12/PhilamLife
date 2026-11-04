// Monetary amounts are checked in integer centavos, not floats.
// A failed or incomplete service-collection lookup must not become PHP 0.
export function totalSettledServiceReceipts(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('Linked service receipts are unavailable.')
  }

  let total = 0

  for (const row of rows) {
    const value = String(row?.amount_paid ?? '').trim()
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
      throw new Error('Linked service payment amount is invalid.')
    }

    const [whole, fraction = ''] = value.split('.')
    const centavos = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

    if (!Number.isSafeInteger(centavos)) {
      throw new Error('Linked service amount exceeds the supported range.')
    }

    total += centavos
    if (!Number.isSafeInteger(total)) {
      throw new Error('Linked service total exceeds the supported range.')
    }
  }

  return total / 100
}
