import { fetchAll } from './fetchAll'

export const EVENT_FIELDS = 'id, title, description, event_date, start_time, end_time, location, created_by, created_by_name, created_at, updated_at'

export function calendarToday(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) || value < '0001-01-01') return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function summarizeCalendarEvents(events, today) {
  const lastDay = new Date(`${today}T00:00:00Z`)
  lastDay.setUTCDate(lastDay.getUTCDate() + 7)
  const nextWeekEnd = lastDay.toISOString().slice(0, 10)
  const month = today.slice(0, 7)
  const stats = { thisMonth: 0, nextSevenDays: 0, today: 0, past: 0 }
  for (const event of events) {
    const date = event.event_date
    if (date.startsWith(month)) stats.thisMonth += 1
    if (date === today) stats.today += 1
    else if (date < today) stats.past += 1
    else if (date <= nextWeekEnd) stats.nextSevenDays += 1
  }
  return stats
}

export function compareCalendarEvents(left, right) {
  return left.event_date.localeCompare(right.event_date)
    || (left.start_time || '').localeCompare(right.start_time || '')
    || String(left.id).localeCompare(String(right.id))
}

export function matchesCalendarSearch(event, search) {
  const term = search.trim().toLowerCase()
  return !term || [event.title, event.location, event.description].some(
    (value) => String(value ?? '').toLowerCase().includes(term),
  )
}

export function calendarMonthDays(cursor) {
  const first = new Date(`${cursor}-01T00:00:00Z`)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first)
    date.setUTCDate(1 - first.getUTCDay() + index)
    const key = `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    return { key, day: date.getUTCDate(), outside: key.slice(0, 7) !== cursor }
  })
}

export function shiftCalendarMonth(cursor, offset) {
  const date = new Date(`${cursor}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return cursor
  return date.toISOString().slice(0, 7)
}

export function calendarFormValues(event) {
  return { title: event.title || '', eventDate: event.event_date || '', startTime: event.start_time || '', endTime: event.end_time || '', location: event.location || '', description: event.description || '' }
}

// The picker edits hours and minutes, but historical event times can contain
// seconds and fractional seconds. Keep that precision instead of silently
// changing the stored time whenever one picker segment is adjusted.
export function preserveCalendarTimePrecision(previous, nextHourMinute) {
  if (!/^\d{2}:\d{2}$/.test(nextHourMinute)) throw new Error('Choose a valid hour and minute.')
  // The displayed 12:00 AM for a stored 24:00 still denotes the next day.
  if (/^24:00(?::00(?:\.0{1,6})?)?$/.test(previous || '') && nextHourMinute === '00:00') return previous
  const suffix = /^\d{2}:\d{2}(:\d{2}(?:\.\d{1,6})?)?$/.exec(String(previous || ''))?.[1] || ''
  return `${nextHourMinute}${suffix}`
}

function seconds(value) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?$/.exec(value)
  if (!match) return null
  const [, hour, minute, second = '00', fraction = '0'] = match
  const total = Number(hour) * 3600 + Number(minute) * 60 + Number(second) + Number(fraction)
  return Number(minute) < 60 && Number(second) < 60 && Number(hour) <= 24 && total <= 86400 ? total : null
}

export function validateCalendarForm(form) {
  const title = String(form.title || '').trim().replace(/\s+/g, ' ')
  const location = String(form.location || '').trim().replace(/\s+/g, ' ')
  const description = String(form.description || '').trim()
  if (!title) return { error: 'Enter an event title.' }
  if (title.length > 160) return { error: 'Event title must be 160 characters or fewer.' }
  if (location.length > 160) return { error: 'Location must be 160 characters or fewer.' }
  if (description.length > 1000) return { error: 'Description must be 1,000 characters or fewer.' }
  if (!isCalendarDate(form.eventDate)) return { error: 'Choose a valid event date.' }
  if ((form.startTime && seconds(form.startTime) === null) || (form.endTime && seconds(form.endTime) === null)) return { error: 'Choose a valid event time.' }
  if (form.endTime && !form.startTime) return { error: 'Add a start time before adding an end time.' }
  if (form.startTime && form.endTime && seconds(form.endTime) <= seconds(form.startTime)) return { error: 'End time must be later than the start time.' }
  return { payload: { title, description: description || null, event_date: form.eventDate, start_time: form.startTime || null, end_time: form.endTime || null, location: location || null } }
}

export async function loadCalendarEvents(client) {
  const { data, error } = await fetchAll(() => client.from('events').select(EVENT_FIELDS)
    .order('event_date', { ascending: true }).order('start_time', { ascending: true, nullsFirst: true }))
  if (error) throw error
  if (!Array.isArray(data) || data.some((row) => !isCalendarDate(row.event_date))) throw new Error('An event contains an unsupported date. Ask the administrator to review the source record.')
  return data
}

function confirmed(result, id, action) {
  if (result.error && result.error.code !== 'PGRST116') throw result.error
  if (result.error || !result.data?.id || (id && result.data.id !== id)) {
    throw new Error(`No event was ${action}. It may have changed, been deleted, or your access may have changed. Refresh before trying again.`)
  }
  return result.data
}

export async function saveCalendarEvent(client, payload, existing, actor, creationId) {
  if (existing && (!existing.id || !existing.updated_at)) throw new Error('Refresh the event before editing it.')
  if (!existing && (!actor?.id || !creationId)) throw new Error('Reopen the scheduling form before saving.')
  const query = existing
    ? client.from('events').update(payload).eq('id', existing.id).eq('updated_at', existing.updated_at)
    : client.from('events').insert({ ...payload, id: creationId, created_by: actor.id, created_by_name: actor.full_name || actor.email || 'Secretary' })
  const result = await query.select(EVENT_FIELDS).single()
  if (!existing && result.error?.code === '23505') {
    const prior = await client.from('events').select(EVENT_FIELDS).eq('id', creationId).maybeSingle()
    if (prior.error) throw prior.error
    const row = prior.data
    const same = row?.id === creationId && row?.created_by === actor.id && ['title', 'description', 'event_date', 'location'].every((key) => (row[key] ?? null) === (payload[key] ?? null))
      && ['start_time', 'end_time'].every((key) => (row[key] == null && payload[key] == null) || seconds(row[key]) === seconds(payload[key]))
    if (same) return row
    throw new Error('This scheduling attempt may already be saved or changed. Refresh before creating another event.')
  }
  return confirmed(result, existing?.id || creationId, existing ? 'updated' : 'created')
}

export async function deleteCalendarEvent(client, event) {
  if (!event?.id || !event.updated_at) throw new Error('Refresh the event before deleting it.')
  return confirmed(await client.from('events').delete().eq('id', event.id).eq('updated_at', event.updated_at).select('id').single(), event.id, 'deleted')
}
