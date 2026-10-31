export const GRIEVANCE_CATEGORIES = ['Noise', 'Parking', 'Pets', 'Maintenance', 'Neighbor dispute', 'Dues or payment dispute', 'Rule violation', 'Officer conduct', 'Other']
export const GRIEVANCE_STATUSES = ['Received', 'Under review', 'In mediation', 'Awaiting decision', 'Awaiting action', 'Referred', 'Resolved', 'Dismissed', 'Withdrawn']
export const CLOSED_GRIEVANCES = ['Resolved', 'Dismissed', 'Withdrawn']
export const isGrievanceClosed = (status) => CLOSED_GRIEVANCES.includes(status)
export const canUseGrievances = (user) => String(user?.role || '').trim().toLowerCase() === 'treasurer'
export const grievanceNumber = (number) => `GR-${String(number).padStart(5, '0')}`
export const manilaDateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
export const newGrievance = () => ({
  id: crypto.randomUUID(), version: 0, title: '', category: 'Other', status: 'Received',
  complainant: '', respondent: '', property_id: '', location: '', description: '', requested_action: '',
  incident_date: '', assigned_handler: '', follow_up_date: '', rule_reference: '', evidence_notes: '', outcome: '', decision_authority: '',
})
const EDITABLE_FIELDS = ['title', 'category', 'status', 'complainant', 'respondent', 'property_id', 'location', 'description', 'requested_action', 'incident_date', 'assigned_handler', 'follow_up_date', 'rule_reference', 'evidence_notes', 'outcome', 'decision_authority']
export function grievanceRequest(form, note, today = manilaDateKey()) {
  for (const field of ['title', 'complainant', 'respondent', 'location', 'description']) {
    if (!String(form[field] || '').trim()) throw new Error('Complete the title, people involved, location and description.')
  }
  if (!note.trim()) throw new Error('Add a note explaining this record or update.')
  if (form.incident_date && form.incident_date > today) throw new Error('The incident date cannot be in the future.')
  if (isGrievanceClosed(form.status) && !form.outcome.trim()) throw new Error('Record the outcome before closing this case.')
  if (['Resolved', 'Dismissed'].includes(form.status) && !form.decision_authority.trim()) throw new Error('Record who authorized the decision.')
  const details = Object.fromEntries(EDITABLE_FIELDS.map((key) => [key, typeof form[key] === 'string' ? form[key].trim() : form[key]]))
  details.property_id = form.property_id ? Number(form.property_id) : null
  return { p_case_id: form.id, p_expected_version: form.version, p_details: details, p_note: note.trim() }
}
export function statementMovement(report) {
  const closed = Number(report.resolved) + Number(report.dismissed) + Number(report.withdrawn)
  const attention = Number(report.opening) + Number(report.received) + Number(report.reopened)
  return { closed, attention, expectedClosing: attention - closed, reconciles: attention - closed === Number(report.closing) }
}
export function statementRows(report) {
  const movement = statementMovement(report)
  return [
    ['Open at beginning', report.opening], ['New complaints received', report.received],
    ['Cases reopened', report.reopened], ['Total requiring attention', movement.attention],
    ['Less: Closed - resolved', report.resolved], ['Less: Closed - dismissed', report.dismissed],
    ['Less: Closed - withdrawn', report.withdrawn], ['Open at end', report.closing],
  ]
}
