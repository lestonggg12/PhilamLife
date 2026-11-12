// Step 3C: isolated cloud write adapter. Not wired to the Grievances UI yet.
// Existing browser-local complaints are never read, modified, or imported here.
const LIMITS = { title: 160, complainant: 200, respondent: 200, location: 300,
  description: 6000, requestedAction: 3000, handler: 200, note: 4000 }

function clean(value) { return String(value ?? '').trim() }

export function buildNewGrievanceDetails(draft, note) {
  if (!draft || typeof draft !== 'object') throw new Error('Enter grievance details.')
  const details = {
    title: clean(draft.title),
    category: clean(draft.category) || 'Other',
    status: 'Received', // New shared cases must start in the server-approved state.
    complainant: clean(draft.filedBy),
    respondent: clean(draft.concerns),
    location: clean(draft.location),
    description: clean(draft.description),
    requested_action: clean(draft.requestedAction),
    assigned_handler: clean(draft.handler),
    incident_date: clean(draft.incidentDate) || null,
    follow_up_date: clean(draft.followUp) || null,
  }
  const fields = {
    title: LIMITS.title, complainant: LIMITS.complainant,
    respondent: LIMITS.respondent, location: LIMITS.location,
    description: LIMITS.description, requested_action: LIMITS.requestedAction,
    assigned_handler: LIMITS.handler,
  }
  for (const [key, max] of Object.entries(fields)) {
    if (details[key].length > max) throw new Error(`${key.replaceAll('_', ' ')} is too long.`)
  }
  for (const key of ['title', 'complainant', 'respondent', 'location', 'description']) {
    if (!details[key]) throw new Error(`Enter ${key.replaceAll('_', ' ')}.`)
  }
  const allowedCategories = ['Noise', 'Parking', 'Pets', 'Maintenance', 'Neighbor dispute',
    'Dues or payment dispute', 'Rule violation', 'Officer conduct', 'Other']
  if (!allowedCategories.includes(details.category)) throw new Error('Choose a valid category.')
  if (!clean(note) || clean(note).length > LIMITS.note) throw new Error('Enter a case note (up to 4000 characters).')
  return details
}

export async function saveNewGrievanceToCloud(supabase, draft, note, caseId) {
  if (!supabase?.rpc) throw new Error('Shared grievance storage is unavailable.')
  if (!caseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(caseId)) {
    throw new Error('A valid unique case ID is required.')
  }
  const details = buildNewGrievanceDetails(draft, note)
  const { data, error } = await supabase.rpc('save_grievance', {
    p_case_id: caseId,
    p_expected_version: 0,
    p_details: details,
    p_note: clean(note),
  })
  if (error) throw error
  if (!data || String(data.id).toLowerCase() !== caseId.toLowerCase()) {
    throw new Error('Cloud save could not be confirmed. Refresh before trying again.')
  }
  return data
}
