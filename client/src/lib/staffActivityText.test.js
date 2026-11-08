import { describe, expect, it, vi } from 'vitest'
import { staffActivityCopy, staffNotificationCopy, loadStaffActivityContext } from './staffActivityText'
const id='00000000-0000-0000-0000-000000000001'
const copy=(action,target,context={})=>staffActivityCopy({action,target},{},context).text

describe('staff activity descriptions',()=>{
 it.each([
  ['Payment Recorded','OR-2026-000001 — Test Owner — ₱150.00','Received ₱150.00 from Test Owner'],
  ['Payment Voided','OR-2026-000001 — Test Owner — ₱150.00 — Duplicate receipt','Reason: Duplicate receipt'],
  ['Charge Voided','Special Assessment — Test Owner — ₱150.00 — Wrong amount','Cancelled a special assessment charge'],
  ['Balance Added',`Test Owner — Association Dues — ₱20,000.00 as of 2025-11-06 [Balance entry: ${id}; Property: 12] — Opening balance`,'dated November 6, 2025'],
  ['Settings Updated','price_per_sqm: 5.00 → 4.00','The association dues rate changed from ₱5.00 to ₱4.00 per square meter.'],
  ['Contact Updated','Test Owner — Block 4, Lot 9 — contact_email: empty → test@example.com; contact_phone: empty → 09123456789','Phone number changed from not previously set to 09123456789'],
  ['Homeowner Moved','Test Owner — Block 4, Lot 9 — homeowner_status: active → moved; status_effective_date: empty → 2026-11-05','Marked Test Owner as moved out'],
  ['Homeowner Transferred',`Previous Owner -> New Owner — Block 3, Lot 12; Balance: -12000.00; Effective: 2026-10-31; Transfer ID: ${id}`,'Advance credit of ₱12,000.00 was transferred'],
  ['Manual Payment Discount',`Payment OR-2026-000001 / property 15 / gross PHP 99627.56 / cash PHP 99527.56 / discount PHP 100 / staff ${id}`,'Approved a ₱100.00 discount'],
  ['Returned Payment Change','Payment OR-2026-000001 / property 15 / tendered PHP 99900 / returned PHP 372.44 / retained PHP 99527.56','returned ₱372.44 as change'],
  ['Receipt Viewed',`Regular receipt OR-2026-000001 — Record ID ${id}`,'Opened payment receipt OR-2026-000001.'],
  ['Service Balance Collected','SR-2026-000002 — ₱51.00 for SR-2026-000001 — Test Owner','toward the remaining amount on service receipt SR-2026-000001'],
  ['Service Receipt Voided','SR-2026-000001 — Function Hall for Test Owner — ₱300.00 — Cancelled booking','Cancelled service receipt'],
  ['Printer Alignment Updated','Shared receipt calibration: horizontal 0.57 mm; vertical 0.90 mm; revision 4','0.57 mm horizontally'],
  ['Same-Day Annual Penalty Rate Override',`classification=lot_owner previous_rate=0.015 new_rate=0.02 effective=2026-11-08 override_id=${id}`,'from 1.5% to 2%'],
 ])('explains %s without database identifiers',(action,target,expected)=>{
  const result=copy(action,target)
  expect(result).toContain(expected)
  expect(result).not.toMatch(/00000000-|Record ID|Transfer ID|contact_email|previous_rate|Balance entry:/)
 })
 it('explains approved budgets with pesos and preserves the stored description',()=>{
  const log={action:'Expense Budget Approved',target:'Year 2026 / Utilities: not recorded -> 10000 PHP; reason: Board Approved Budget for 2026'}
  const before=JSON.stringify(log)
  expect(staffActivityCopy(log).text).toBe('Approved ₱10,000.00 for utilities expenses in 2026. No budget had been recorded before this approval. Reason: Board Approved Budget for 2026.')
  expect(JSON.stringify(log)).toBe(before)
 })
 it('resolves internal payment numbers to a receipt and account, with a safe missing-record description',()=>{
  const context={paymentsById:new Map([['253',{receipt_number:'OR-2026-000001',homeowner_name:'Test Owner',block_name:'Block 4',lot_number:9}]])}
  expect(copy('Paper Invoice Number Assigned','Invoice 1023 — payment 253',context)).toContain('receipt OR-2026-000001 for Test Owner (Block 4, Lot 9)')
  expect(copy('Paper Invoice Number Assigned','Invoice 1023 — payment 253')).toBe('Assigned paper invoice 1023 to a recorded payment.')
 })
 it('resolves yearly penalties without displaying a property number',()=>{
  const context={properties:new Map([['15',{homeowner_name:'Test Owner',block:'Block 1',lot_number:2}]])}
  expect(copy('Annual Penalty Posted',`Property 15 — PHP 150 at 3% on PHP 5000; anniversary 2026-11-08; charge ${id}`,context)).toContain('3% annual late-payment penalty of ₱150.00 for Test Owner (Block 1, Lot 2), based on ₱5,000.00')
 })
 it('loads only the required descriptive lookup fields and tolerates a failed lookup',async()=>{
  const from=vi.fn(table=>({select:vi.fn(()=>({in:vi.fn(async()=>table==='payments'?{data:[{id:253,receipt_number:'OR-2026-000001'}]}:{error:new Error('offline')})}))}))
  const context=await loadStaffActivityContext({from},[{target:'Invoice 1023 — payment 253 / property 15'}])
  expect(context.paymentsById.get('253').receipt_number).toBe('OR-2026-000001')
  expect(context.properties.size).toBe(0)
 })
})
describe('plain-language notification and account activity',()=>{
 it('explains the actual settings change using formatted database amounts',()=>{
  expect(staffNotificationCopy({kind:'settings_changed',payload:{changes:[{field:'price_per_sqm',before_formatted:'₱5.00/sqm',after_formatted:'₱4.00/sqm'}]}})).toMatchObject({title:'Association dues rate changed',body:'The association dues rate changed from ₱5.00 to ₱4.00 per square meter.'})
 })
 it('explains a cancelled payment and linked discount without technical references',()=>{
  const result=staffNotificationCopy({kind:'transaction_voided',payload:{source_table:'payments',reference:'OR-2026-000001',amount_formatted:'₱280.00',reason:'Wrong payment',accounts:[{name:'Test Owner',block:'Block 1',lot_number:9}],related_reversals:[{kind:'Discount reversed',reference:id,amount_formatted:'₱100.00'}]}})
  expect(result.body).toContain("on Test Owner (Block 1, Lot 9)'s account was cancelled. Reason: Wrong payment.")
  expect(result.related).toEqual(['The ₱100.00 discount was removed when the transaction was cancelled.'])
  expect(JSON.stringify(result)).not.toContain(id)
 })
 it('uses the actual penalty rate and eligible unpaid amount, not an invented current balance',()=>{
  const result=staffNotificationCopy({kind:'penalty_applied',payload:{rate_formatted:'1.75%',penalty_formatted:'₱17.50',base_formatted:'₱1,000.00',anniversary_date:'2026-11-08',accounts:[{name:'Test Owner',classification:'lot_owner'}]}})
  expect(result.body).toContain('1.75% late-payment penalty of ₱17.50')
  expect(result.body).toContain('based on ₱1,000.00 that remained unpaid')
  expect(result.body).toContain('Property type: lot owner')
 })
 it('keeps delayed-report dates and anniversary catch-up details visible',()=>{
  expect(staffNotificationCopy({kind:'collection_run',payload:{credit_deducted_formatted:'₱100.00',collection_date:'2026-11-03',observed_on:'2026-11-08'}}).body).toContain('as of November 8, 2026')
  expect(staffNotificationCopy({kind:'penalty_anniversary',payload:{total_formatted:'₱150.00',caught_up_balances:2}}).body).toContain('2 penalties for earlier anniversaries')
 })
 it('describes a new budget and credit deductions without calculating money',()=>{
  expect(staffNotificationCopy({kind:'settings_changed',payload:{category:'Utilities',year:2026,before:null,after:10000,reason:'Board approved'}}).body).toContain('₱10,000.00')
  expect(staffNotificationCopy({kind:'credit_applied',payload:{credit_used_formatted:'₱40.00',billing_month:'2026-11-01'}}).body).toContain('used ₱40.00 of advance credit to pay November 2026 association dues')
 })
})
it('keeps the database warning when an account was billed before its balance snapshot',()=>{
 expect(staffNotificationCopy({kind:'collection_run',body:'Accounts billed before the snapshot are excluded from deduction totals.',payload:{credit_deducted_formatted:'₱100.00'}}).body).toContain('excluded from the advance-credit totals')
})

it('keeps long settings descriptions, semicolons and line breaks in staff-readable details',()=>{
 const address='Building A; second floor\n'+ 'Long address '.repeat(60)+'END OF ADDRESS'
 const text=staffActivityCopy({action:'Settings Updated',target:`address: Previous office → ${address}; contact_phone: empty → 09123456789`}).text
 expect(text).toContain('second floor')
 expect(text).toContain('END OF ADDRESS')
 expect(text).toContain('09123456789')
 expect(text.length).toBeGreaterThan(500)
})
