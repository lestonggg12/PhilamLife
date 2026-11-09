// The payment row captures the balance after cash. A manual discount is
// committed separately in the discount journal within the same transaction.
function cents(value) {
  const text = String(value ?? '')
  const result = Math.round(Number(text) * 100)
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text) || !Number.isSafeInteger(result)) {
    throw new Error('Receipt balance or discount could not be verified.')
  }
  return result
}

export async function loadPaymentReceipt(client, payment) {
  const { data: discount, error } = await client.from('manual_payment_discounts')
    .select('payment_id, discount_amount, gross_amount, cash_received, charge_id, approval_reference')
    .eq('payment_id', payment.id).maybeSingle()
  if (error) throw error
  return discount
    ? { ...payment, manual_discount: discount, remaining_balance: balanceAtReceiptIssuance(payment, discount) }
    : payment
}

export function balanceAtReceiptIssuance(payment, discount) {
  if (!discount) return cents(payment.remaining_balance) / 100
  const reduction = cents(discount.discount_amount)
  const balance = cents(payment.remaining_balance) - reduction
  if (String(discount.payment_id) !== String(payment.id) || reduction <= 0 ||
      cents(discount.cash_received) !== cents(payment.amount_paid ?? payment.amount) ||
      cents(discount.gross_amount) !== cents(discount.cash_received) + reduction ||
      !Number.isSafeInteger(balance)) {
    throw new Error('The receipt does not match its recorded discount.')
  }
  return balance / 100
}
