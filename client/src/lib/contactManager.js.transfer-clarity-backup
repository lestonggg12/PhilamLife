import { calendarToday, isCalendarDate } from './eventCalendar'
import { ilikeAny, pageWindow, searchTokens } from './pagedQuery'

export const CONTACT_COLUMNS = 'id, homeowner_id, block, lot_number, homeowner_name, contact_phone, contact_email, contact_updated_at, homeowner_status, status_effective_date, status_reason, status_updated_at'
const SEARCH_COLUMNS = ['homeowner_name', 'block', 'contact_phone', 'contact_email', 'homeowner_status', 'status_reason']

export function contactSearchTokens(search) {
  // Remove field labels before applying the shared five-word limit.
  return searchTokens(String(search || '').replace(/\b(?:block|lot)\b/gi, ' '))
}

export function requireEffectiveDate(value, today = calendarToday()) {
  if (!isCalendarDate(value) || value > today) throw new Error('Choose a valid effective date of today or earlier.')
  return value
}

export async function loadContactCounts(client) {
  const statuses = ['active', 'moved', 'transferred']
  const results = await Promise.all(statuses.map((status) => client.from('properties')
    .select('id', { count: 'exact', head: true }).eq('homeowner_status', status)))
  const failed = results.find(({ error }) => error)
  if (failed) throw failed.error
  if (results.some(({ count }) => !Number.isInteger(count) || count < 0)) throw new Error('Property-account counts could not be verified.')
  return Object.fromEntries(statuses.map((status, index) => [status, results[index].count]))
}

export async function loadContactPage(client, status, tokens, page) {
  const { from, to } = pageWindow(page)
  let query = client.from('properties').select(CONTACT_COLUMNS, { count: 'exact' })
  if (status !== 'all') query = query.eq('homeowner_status', status)
  for (const token of tokens) {
    const filters = [ilikeAny(SEARCH_COLUMNS, token)]
    if (/^\d{1,6}$/.test(token)) filters.push(`lot_number.eq.${token}`)
    query = query.or(filters.join(','))
  }
  const result = await query.order('homeowner_name', { ascending: true }).order('id', { ascending: true }).range(from, to)
  if (result.error) throw result.error
  if (!Array.isArray(result.data) || !Number.isInteger(result.count) || result.count < 0) throw new Error('The contact directory response could not be verified.')
  return { rows: result.data, total: result.count }
}

function confirmedContact(result, id) {
  if (result.error) throw result.error
  if (!result.data || String(result.data.id) !== String(id)) throw new Error('The saved account could not be confirmed. Reload before trying again.')
  return result.data
}

export async function saveContactDetails(client, contact, form) {
  if (!contact?.id || !contact.homeowner_id) throw new Error('Reload this contact before saving.')
  const phone = form.phone.trim().replace(/\s+/g, ' ')
  const email = form.email.trim().toLowerCase()
  if (phone.length > 30) throw new Error('Phone number must be 30 characters or fewer.')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.')
  return confirmedContact(await client.rpc('save_homeowner_contact', {
    p_property_id: contact.id, p_expected_homeowner_id: contact.homeowner_id,
    p_expected_phone: contact.contact_phone ?? null, p_expected_email: contact.contact_email ?? null,
    p_expected_updated_at: contact.contact_updated_at ?? null,
    p_phone: phone || null, p_email: email || null,
  }).single(), contact.id)
}

export async function moveContact(client, contact, form) {
  requireEffectiveDate(form.effectiveDate)
  if (!contact?.id || !contact.homeowner_id || contact.homeowner_status !== 'active') throw new Error('Reload this active account before moving it.')
  const row = confirmedContact(await client.rpc('move_homeowner', {
    p_property_id: contact.id, p_expected_homeowner_id: contact.homeowner_id,
    p_expected_updated_at: contact.status_updated_at ?? null,
    p_effective_date: form.effectiveDate, p_note: form.reason.trim() || null,
  }).single(), contact.id)
  if (row.homeowner_status !== 'moved') throw new Error('The move could not be confirmed. Reload before trying again.')
  return row
}

export function confirmedTransfer(data) {
  const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data
  const amount = row?.transferred_balance
  if (!row?.new_property_id || amount === null || amount === undefined || amount === '' ||
      !['number', 'string'].includes(typeof amount) || !Number.isFinite(Number(amount))) {
    throw new Error('The transfer result could not be confirmed. Reload the account before trying again.')
  }
  return { ...row, transferred_balance: Number(amount) }
}
