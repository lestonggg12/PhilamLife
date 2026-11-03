// The payment form may only use a complete, verified setup snapshot.
// A rejected query or missing balance is not a zero balance.
export function paymentSetupErrors({ propertyResult, settingsResult, billedResult, duesResult }) {
  const results = [propertyResult, settingsResult, billedResult, duesResult]
  const errors = results.filter((result) => result?.error).map((result) => result.error.message || 'A setup query failed.')
  if (!settingsResult?.data || !Array.isArray(propertyResult?.data) ||
      !Array.isArray(billedResult?.data) || !Array.isArray(duesResult?.data) ||
      propertyResult.data.some((property) =>
        property.current_balance == null || !Number.isFinite(Number(property.current_balance)))) {
    errors.push('One or more required payment setup values could not be verified.')
  }
  return errors
}
