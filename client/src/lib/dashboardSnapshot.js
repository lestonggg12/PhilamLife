// A snapshot must match the active Manila calendar month before its figures
// can be displayed. This is independent of network requests and never mutates records.
export function isVerifiedDashboardSnapshot({ period, verifiedPeriod, loading, error }) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(String(period || '')) &&
    period === verifiedPeriod && !loading && !error
}
