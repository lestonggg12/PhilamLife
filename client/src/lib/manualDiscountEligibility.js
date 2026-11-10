// Manual discounts reduce outstanding debt only when the payment settles it in full.
// Unlike the separate 12-month promotion, they cannot fund an advance or a partial payment.
const cents = (value) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  const rounded = Math.round(number * 100)
  return Number.isSafeInteger(rounded) ? rounded : null
}

export function manualDiscountSettlesFullBalance({
  outstandingBalance,
  cashRetained,
  discountAmount,
  isBalanceReducingPayment,
}) {
  const due = cents(outstandingBalance)
  const paid = cents(cashRetained)
  const discount = cents(discountAmount)
  return Boolean(isBalanceReducingPayment && due !== null && paid !== null &&
    discount !== null && due > 0 && discount > 0 && discount < due &&
    paid + discount === due)
}
