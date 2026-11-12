import { describe, expect, it, vi } from 'vitest'
import { buildNewGrievanceDetails, saveNewGrievanceToCloud } from './grievanceCloud'

const ID = 'd451de7b-8cd6-4c45-a15b-0e87ad5634e2'
const draft = {
  title: ' Test issue ', category: 'Noise', filedBy: ' Resident A ',
  concerns: ' Resident B ', location: ' Common area ', description: 'Example only',
  requestedAction: 'Discuss', handler: 'Secretary', incidentDate: '', followUp: '',
  status: 'Resolved', // Must NOT be copied into a new cloud case.
}

describe('grievance cloud create adapter', () => {
  it('maps local field names to server fields and forces Received status', () => {
    expect(buildNewGrievanceDetails(draft, 'Initial note')).toMatchObject({
      title: 'Test issue', complainant: 'Resident A', respondent: 'Resident B',
      status: 'Received', category: 'Noise', requested_action: 'Discuss',
      assigned_handler: 'Secretary', incident_date: null,
    })
  })
  it('refuses missing required fields before making a request', async () => {
    const rpc = vi.fn()
    await expect(saveNewGrievanceToCloud({ rpc }, { ...draft, title: '' }, 'Note', ID))
      .rejects.toThrow(/title/i)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('uses the existing guarded RPC and verifies returned case identity', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: ID, case_number: 21 }, error: null })
    const row = await saveNewGrievanceToCloud({ rpc }, draft, 'Initial note', ID)
    expect(row.case_number).toBe(21)
    expect(rpc).toHaveBeenCalledWith('save_grievance', expect.objectContaining({
      p_case_id: ID, p_expected_version: 0, p_details: expect.objectContaining({ status: 'Received' }),
      p_note: 'Initial note',
    }))
  })
  it('propagates server permission errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('Permission denied') })
    await expect(saveNewGrievanceToCloud({ rpc }, draft, 'Note', ID))
      .rejects.toThrow('Permission denied')
  })
  it('rejects unconfirmed saves instead of reporting success', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'other' }, error: null })
    await expect(saveNewGrievanceToCloud({ rpc }, draft, 'Note', ID))
      .rejects.toThrow(/could not be confirmed/i)
  })
})
