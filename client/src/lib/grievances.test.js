import { describe, expect, it } from 'vitest'
import { canUseGrievances, grievanceNumber, grievanceRequest, isGrievanceClosed, manilaDateKey, statementMovement } from './grievances'
const form = { id:'test',version:0,title:'Noise',category:'Noise',status:'Received',complainant:'A',respondent:'B',location:'Gate',description:'Loud music',outcome:'',decision_authority:'',property_id:'',incident_date:'' }
describe('Treasurer grievances', () => {
 it('allows only the Treasurer', () => { expect(canUseGrievances({role:' Treasurer '})).toBe(true); for (const role of ['admin','secretary','',undefined]) expect(canUseGrievances({role})).toBe(false) })
 it('keeps referred cases open and recognizes closing outcomes', () => { expect(isGrievanceClosed('Referred')).toBe(false); for (const status of ['Resolved','Dismissed','Withdrawn']) expect(isGrievanceClosed(status)).toBe(true) })
 it('creates a narrow request without allowing history or balance fields', () => { const request=grievanceRequest({...form,current_balance:'999',filed_at:'2000-01-01'},'  Filing note  '); expect(request.p_note).toBe('Filing note'); expect(request.p_details).not.toHaveProperty('current_balance'); expect(request.p_details).not.toHaveProperty('filed_at'); expect(request.p_details.property_id).toBeNull() })
 it('requires the basic facts and a saved-history note', () => { expect(()=>grievanceRequest({...form,title:' '},'note')).toThrow(); expect(()=>grievanceRequest(form,' ')).toThrow() })
 it('requires outcomes and authority for resolved or dismissed cases', () => { expect(()=>grievanceRequest({...form,status:'Resolved'},'note')).toThrow(/outcome/); expect(()=>grievanceRequest({...form,status:'Dismissed',outcome:'Not upheld'},'note')).toThrow(/authorized/); expect(grievanceRequest({...form,status:'Resolved',outcome:'Corrected',decision_authority:'Committee'},'Resolution recorded').p_details.status).toBe('Resolved') })
 it('allows withdrawal with a recorded outcome', () => { expect(grievanceRequest({...form,status:'Withdrawn',outcome:'Complainant withdrew'},'Withdrawal received').p_details.status).toBe('Withdrawn') })
 it('rejects future incident dates', () => { expect(()=>grievanceRequest({...form,incident_date:'2026-11-01'},'note','2026-10-31')).toThrow(/future/) })
 it('uses Manila dates across the UTC boundary', () => { expect(manilaDateKey(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01') })
 it('reconciles opening, new, reopening and closing movements', () => { expect(statementMovement({opening:12,received:18,reopened:2,resolved:14,dismissed:2,withdrawn:1,closing:15})).toEqual({closed:17,attention:32,expectedClosing:15,reconciles:true}) })
 it('rejects inconsistent closing totals and handles empty periods', () => { expect(statementMovement({opening:0,received:0,reopened:0,resolved:0,dismissed:0,withdrawn:0,closing:0}).reconciles).toBe(true); expect(statementMovement({opening:1,received:0,reopened:0,resolved:0,dismissed:0,withdrawn:0,closing:0}).reconciles).toBe(false) })
 it('formats long case numbers without truncating them', () => { expect(grievanceNumber(12)).toBe('GR-00012');expect(grievanceNumber(123456)).toBe('GR-123456') })
})
