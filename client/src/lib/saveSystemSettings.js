// Save through the guarded RPC so an older browser tab cannot overwrite a
// newer Admin save. The server returns the committed singleton row.
export async function saveSystemSettings(client, payload, expectedRevision, refreshOrganization) {
  const { data, error } = await client.rpc('save_system_settings_guarded', {
    p_expected_revision: expectedRevision,
    p_hoa_name: payload.hoa_name,
    p_address: payload.address,
    p_contact_email: payload.contact_email,
    p_contact_phone: payload.contact_phone,
    p_billing_day: payload.billing_day,
    p_due_day: payload.due_day,
    p_grace_period_days: payload.grace_period_days,
    p_require_strong_password: payload.require_strong_password,
    p_session_timeout: payload.session_timeout,
    p_currency: payload.currency,
    p_timezone: payload.timezone,
    p_date_format: payload.date_format,
  })
  if (error) throw error
  const saved = Array.isArray(data) ? data[0] : data
  if (!saved || Number(saved.id) !== 1 || !Number.isSafeInteger(Number(saved.settings_revision))) {
    throw new Error('No settings row was updated. Refresh the page and check your permissions.')
  }

  // The write has committed. A refresh failure must never be called a failed save.
  try {
    const refreshed = await refreshOrganization(saved)
    return { settings: saved, refreshError: refreshed?.error || null, cacheError: refreshed?.cacheError || null }
  } catch (refreshError) {
    return { settings: saved, refreshError, cacheError: null }
  }
}
