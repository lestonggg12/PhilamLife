export function requireHomeownerSnapshot(duesResult, propertyResult, paymentResult) {
  const failure = duesResult?.error || propertyResult?.error || paymentResult?.error
  if (failure) throw failure
  if (![duesResult?.data, propertyResult?.data, paymentResult?.data].every(Array.isArray)) {
    throw new Error('The homeowner directory response is incomplete.')
  }
  if (
    propertyResult.data.length === 0 &&
    (duesResult.data.length > 0 || paymentResult.data.length > 0)
  ) {
    throw new Error('The homeowner directory response is incomplete.')
  }
  for (const property of propertyResult.data) {
    if (property.current_balance == null || !Number.isFinite(Number(property.current_balance))) {
      throw new Error('A homeowner balance is missing or invalid. Refresh the directory.')
    }
  }
  for (const payment of paymentResult.data) {
    if (
      payment.active_payment_count == null ||
      !Number.isInteger(Number(payment.active_payment_count)) ||
      Number(payment.active_payment_count) < 0
    ) {
      throw new Error('A homeowner payment count is missing or invalid. Refresh the directory.')
    }
  }
  return { dues: duesResult.data, properties: propertyResult.data, payments: paymentResult.data }
}
