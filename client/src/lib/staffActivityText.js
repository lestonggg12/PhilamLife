// Presentation only. Original audit text and transaction amounts are never edited.
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const percent = new Intl.NumberFormat('en-PH', { style: 'percent', maximumFractionDigits: 4 })
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const labels = {
  price_per_sqm: 'Association dues rate per square meter', hoa_name: 'Association name', address: 'Association address',
  contact_email: 'Email address', contact_phone: 'Phone number', homeowner_name: 'Homeowner name', homeowner_status: 'Residency status',
  property_classification: 'Property type', old_classification: 'Previous property type', new_classification: 'New property type',
  status_effective_date: 'Effective date', effective_from: 'Effective date', billing_day: 'Monthly collection day', due_day: 'Payment deadline day',
  grace_period_days: 'Extra days allowed before a payment becomes overdue', late_penalty_first_after_months: 'Months before the first annual penalty',
  late_penalty: 'Late-payment penalty setting', annual_rate: 'Annual penalty rate', late_penalty_rate: 'Annual penalty rate', session_timeout: 'Automatic sign-out time in minutes',
  require_strong_password: 'Strong password requirement', two_factor: 'Two-step verification', date_format: 'Date format', timezone: 'Time zone',
  email_on_payment: 'Payment email setting', email_on_overdue: 'Overdue email setting', sms_reminders: 'Text-message reminder setting',
  weekly_digest: 'Weekly summary setting', reminder_days_before: 'Days before a reminder', currency: 'Currency', block: 'Block', lot_number: 'Lot number',
  lot_size_sqm: 'Lot size in square meters', fine_amount: 'Fine amount', fine_collected: 'Fine collected', date_issued: 'Date issued', date_resolved: 'Date resolved',
  category: 'Category', status: 'Status', description: 'Description', notes: 'Notes', reason: 'Reason', rule_note: 'Reason',
}
const actionLabels = {
 'Payment Recorded':'Payment received','Payment Voided':'Payment cancelled','Charge Added':'Charge added','Charge Voided':'Charge cancelled',
 'Balance Added':'Balance entered','Balance Voided':'Entered balance cancelled','Expense Recorded':'Expense recorded','Expense Voided':'Expense cancelled',
 'Settings Updated':'System settings changed','Expense Budget Approved':'Expense budget approved','Homeowner Moved':'Homeowner marked as moved out',
 'Homeowner Transferred':'Property ownership transferred','Homeowner Updated':'Homeowner details changed','Contact Updated':'Contact details changed',
 'Homeowner Added':'Homeowner added','Homeowner Removed':'Homeowner removed','Block Added':'Block added','Block Removed':'Block removed',
 'Service Payment Recorded':'Amenity or service payment received','Service Balance Collected':'Remaining service payment received','Service Receipt Voided':'Service receipt cancelled',
 'Manual Payment Discount':'Payment discount approved','Returned Payment Change':'Payment change returned','Paper Invoice Number Assigned':'Paper invoice number assigned',
 'Printer Alignment Updated':'Receipt print position changed','Receipt Viewed':'Receipt opened','Receipt Print Requested':'Receipt print requested','Receipt Printed':'Receipt printed','Receipt Downloaded':'Receipt downloaded',
 'Annual Penalty Posted':'Annual late-payment penalty added','Same-Day Annual Penalty Rate Override':'Annual penalty rate changed for today',
 'Penalty Rate Rule Created':'Annual penalty rate scheduled','Penalty Rate Override Created':'Annual penalty rate changed',
 'Document Uploaded':'Document uploaded','Document Deleted':'Document deleted','Grievance Recorded':'Complaint recorded','Grievance Updated':'Complaint updated',
 'Collection Follow-up Recorded':'Payment follow-up recorded','Property Classification Created':'Property type verified',
}
export const staffActionLabel = (action) => actionLabels[action] || String(action || 'Activity').replaceAll('_', ' ')
export const staffFieldLabel = (key) => labels[key] || String(key).replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase())
export function displayMoney(value) {
 if (value === null || value === undefined || value === '' || /^(empty|not recorded|null)$/i.test(String(value))) return 'not previously set'
 if (String(value).includes('₱')) return String(value).trim()
 const number = Number(String(value).replace(/PHP|,/gi, '').trim())
 return Number.isFinite(number) ? peso.format(number) : String(value)
}
export function staffDate(value) {
 const text = String(value || '')
 if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || 'date not recorded'
 const date = new Date(`${text}T12:00:00+08:00`)
 return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-PH', { timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric' }).format(date) : text
}
function friendlyValue(key, value) {
 const text=String(value ?? '').trim()
 if (!text || /^(empty|null|not recorded)$/i.test(text)) return 'not previously set'
 if (/^\[(redacted|changed)\]$/.test(text)) return 'recorded separately'
 if (/^(annual_rate|late_penalty_rate|previous_rate|new_rate)$/.test(key) && Number.isFinite(Number(text))) return percent.format(Number(text))
 if (key==='price_per_sqm') return displayMoney(text)
 if (/date|effective/.test(key)) return staffDate(text)
 const names={true:'on',false:'off',active:'active',moved:'moved out',transferred:'ownership transferred',lot_owner:'lot owner',homeowner:'homeowner',unclassified:'not yet classified'}
 return names[text] || text
}
function stripInternal(text) {
 return String(text || '')
  .replace(/â€”/g,' — ').replace(/â†’/g,' → ')
  .replace(/\s*\[(?:Balance entry|Expense|Collection action):[^\]]*\]/gi,'')
  .replace(/\s*[;—]\s*(?:Record ID|Transfer ID|Charge ID|Source ID):?\s*[^;]+$/gi,'')
  .replace(/\s*—\s*Record ID\s+\S+/gi,'')
  .replace(uuid,'').replace(/\b(?:record|property|payment|charge|source|staff)[_ ]id\s*[:=]?\s*\d+/gi,'')
  .replace(/(^|;\s*)([a-z][a-z0-9]*(?:_[a-z0-9]+)+):/g,(_m,p,key)=>p+staffFieldLabel(key)+':')
  .replace(/\s{2,}/g,' ').trim()
}
function changeSentences(text) {
 const changes=[]
 const matcher=/(?:^|;\s*)([a-z][a-z0-9_]*):\s*([\s\S]*?)\s*(?:→|->)\s*([\s\S]*?)(?=;\s*[a-z][a-z0-9_]*:\s*|$)/g
 for (const match of text.matchAll(matcher)) {
  const [,key,from,to]=match
  const before=friendlyValue(key,from),after=friendlyValue(key,to)
  changes.push(key==='price_per_sqm'
   ? `The association dues rate changed from ${before} to ${after} per square meter.`
   : `${staffFieldLabel(key)} changed from ${before} to ${after}.`)
 }
 return changes.join(' ')
}
function blockLabel(block) {
 const value=String(block || '').replace(/^Block\s+(?=Block\b)/i,'').trim()
 return !value ? '' : /block/i.test(value) ? value : `Block ${value}`
}
function accountLabel(record) {
 if (!record) return ''
 const name=record.name || record.homeowner_name || ''
 const block=blockLabel(record.block ?? record.block_name)
 const lot=record.lot_number == null ? '' : `Lot ${record.lot_number}`
 return `${name}${block || lot ? ` (${[block,lot].filter(Boolean).join(', ')})` : ''}`.trim()
}
function receiptContext(receipt, context) {
 const payment=context?.paymentsByReceipt?.get(receipt)
 return payment ? accountLabel(payment) : ''
}

export function staffActivityCopy(log, legacy = {}, context = {}) {
 const raw=String(log.target || log.description || '')
 const action=String(log.action || '')
 const actor=String(log.user || '')
 const suffix=actor ? new RegExp(` \\((?:by )?${actor.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\)$`) : null
 const source=(suffix ? raw.replace(suffix,'') : raw).replace(/â€”/g,' — ').replace(/â†’/g,' → ').trim()
 const parts=source.split(/\s+—\s+/)
 let text='',subject='',match
 const label=staffActionLabel(action)
 if (/^(Payment Recorded|Payment Voided)$/.test(action) && /^OR-|^MOCK/i.test(parts[0] || '') && parts.length>=3) {
  subject=parts[0]
  text=action==='Payment Recorded' ? `Received ${parts[2]} from ${parts[1]}. Receipt: ${parts[0]}.`
   : `Cancelled payment ${parts[0]} for ${parts[1]} (${parts[2]}).${parts[3] ? ` Reason: ${parts.slice(3).join(' — ')}.` : ''}`
 } else if (/^(Charge Added|Charge Voided)$/.test(action) && parts.length>=3) {
  subject=parts[1]
  text=`${action==='Charge Added' ? 'Added' : 'Cancelled'} a ${parts[0].toLowerCase()} charge of ${parts[2]} for ${parts[1]}.${parts[3] ? ` Reason: ${parts.slice(3).join(' — ')}.` : ''}`
 } else if (/^Balance (Added|Voided)$/.test(action) && parts.length>=3) {
  subject=parts[0]
  const balance=/^(₱[\d,.]+) as of (\d{4}-\d{2}-\d{2})/.exec(parts[2])
  if (balance) text=`${action==='Balance Added' ? 'Entered' : 'Cancelled'} ${balance[1]} of ${parts[1].toLowerCase()} for ${parts[0]}, dated ${staffDate(balance[2])}.${parts[3] ? ` ${action==='Balance Voided'?'Reason':'Note'}: ${parts.slice(3).join(' — ')}.` : ''}`
 } else if ((match=/^Year (\d{4}) \/ (.+?):\s*(.*?)\s*->\s*([\d.]+) PHP; reason:\s*(.*)$/i.exec(source)) && action==='Expense Budget Approved') {
  subject=`${match[2]} budget for ${match[1]}`
  text=`Approved ${displayMoney(match[4])} for ${match[2].toLowerCase()} expenses in ${match[1]}.${/not recorded/i.test(match[3]) ? ' No budget had been recorded before this approval.' : ` The previous budget was ${displayMoney(match[3])}.`} Reason: ${match[5]}.`
 } else if (action==='Settings Updated') {
  subject='System settings'
  text=changeSentences(source)
 } else if (/^(Homeowner Updated|Contact Updated|Homeowner Moved)$/.test(action) && parts.length>=2) {
  subject=parts[0]
  const where=parts[1]
  const updates=changeSentences(parts.slice(2).join(' — '))
  text=action==='Homeowner Moved'
   ? `Marked ${parts[0]} as moved out from ${where}.${updates ? ` ${updates}` : ''}`
   : `Updated ${action==='Contact Updated'?'contact information':'homeowner details'} for ${parts[0]}, ${where}.${updates ? ` ${updates}` : ''}`
 } else if (action==='Homeowner Added' && parts.length>=2) {
  subject=parts[0];text=`Added ${parts[0]} as a homeowner for ${parts[1]}.`
 } else if (action==='Homeowner Transferred' && (match=/^(.+?)\s*->\s*(.+?) — (.+?); Balance:\s*(-?[\d.]+); Effective:\s*(\d{4}-\d{2}-\d{2})/.exec(source))) {
  subject=`${match[1]} to ${match[2]}`
  const isCredit=match[4].startsWith('-')
  text=`Transferred ownership of ${match[3]} from ${match[1]} to ${match[2]}, effective ${staffDate(match[5])}. ${isCredit ? `Advance credit of ${displayMoney(match[4].slice(1))}` : `An unpaid balance of ${displayMoney(match[4])}`} was transferred to the new account.`
 } else if (/^(Manual Payment Discount|Returned Payment Change)$/.test(action)) {
  const fields=Object.fromEntries([...source.matchAll(/(?:^| \/ )(Payment|property|gross|cash|discount|tendered|returned|retained|staff)\s+(?:PHP\s+)?([^/]+?)(?= \/ |$)/gi)].map(m=>[m[1].toLowerCase(),m[2].trim()]))
  if(fields.payment) {
   subject=fields.payment
   const name=receiptContext(fields.payment,context) || accountLabel(context.properties?.get(fields.property))
   const whose=name ? ` for ${name}` : ''
   text=action==='Manual Payment Discount'
    ? `Approved a ${displayMoney(fields.discount)} discount on payment ${fields.payment}${whose}. The amount before the discount was ${displayMoney(fields.gross)}; ${displayMoney(fields.cash)} was received.`
    : `Received ${displayMoney(fields.tendered)} for payment ${fields.payment}${whose} and returned ${displayMoney(fields.returned)} as change. The association kept ${displayMoney(fields.retained)} for the payment.`
  }
 } else if(action==='Paper Invoice Number Assigned' && (match=/^Invoice (.+?) — payment (\d+)$/.exec(source))) {
  subject=`Paper invoice ${match[1]}`
  const payment=context.paymentsById?.get(match[2])
  text=payment?.receipt_number ? `Assigned paper invoice ${match[1]} to receipt ${payment.receipt_number}${accountLabel(payment) ? ` for ${accountLabel(payment)}`:''}.` : `Assigned paper invoice ${match[1]} to a recorded payment.`
 } else if(action==='Printer Alignment Updated' && (match=/horizontal ([\d.-]+) mm; vertical ([\d.-]+) mm/.exec(source))) {
  subject='Receipt print position';text=`Adjusted the receipt printer position: ${match[1]} mm horizontally and ${match[2]} mm vertically.`
 } else if(/^Receipt (Viewed|Print Requested|Printed|Downloaded)$/.test(action) && (match=/^(Service|Regular) receipt (\S+)/.exec(source))) {
  const verb = { 'Receipt Viewed': 'Opened', 'Receipt Print Requested': 'Requested printing for', 'Receipt Printed': 'Printed', 'Receipt Downloaded': 'Downloaded' }[action]
  subject=match[2];text=`${verb} ${match[1].toLowerCase()==='regular'?'payment':'service'} receipt ${match[2]}.`
 } else if(action==='Service Payment Recorded' && (match=/^(SR-[\w-]+) — (.+) for (.+)$/.exec(source))) {
  subject=match[1];text=`Recorded a payment from ${match[3]} for ${match[2]}. Receipt: ${match[1]}.`
 } else if(action==='Service Balance Collected' && (match=/^(SR-[\w-]+) — (₱[\d,.]+) for (SR-[\w-]+) — (.+)$/.exec(source))) {
  subject=match[1];text=`Received ${match[2]} from ${match[4]} toward the remaining amount on service receipt ${match[3]}. New receipt: ${match[1]}.`
 } else if(action==='Service Receipt Voided' && (match=/^(SR-[\w-]+) — (.+) for (.+) — (₱[\d,.]+) — (.+)$/.exec(source))) {
  subject=match[1];text=`Cancelled service receipt ${match[1]} for ${match[3]}'s ${match[2]} payment of ${match[4]}. Reason: ${match[5]}.`
 } else if(/^Expense (Recorded|Voided)$/.test(action) && legacy.amount!==null && legacy.amount!==undefined) {
  subject=legacy.subject || parts[0]
  text=`${action==='Expense Recorded'?'Recorded':'Cancelled'} a ${displayMoney(legacy.amount)} expense for ${subject.toLowerCase()}.${legacy.detail ? ` ${action==='Expense Voided'?'Reason':'Description'}: ${legacy.detail}.`:''}`
 } else if(/^Document (Uploaded|Deleted)$/.test(action) && parts.length>=2) {
  subject=parts[0];text=`${action==='Document Uploaded'?'Uploaded':'Deleted'} the document “${parts[0]}” (${parts[1]}).`
 } else if(/^Block (Added|Removed)$/.test(action)) {
  subject=blockLabel(source);text=`${action==='Block Added'?'Added':'Removed'} ${subject}.`
 } else if(/^Grievance (Recorded|Updated)$/.test(action) && (match=/^(GR-[\w-]+) (?:-|—) (.+) (?:-|—) (.+)$/.exec(source))) {
  subject=match[1];text=action==='Grievance Recorded' ? `Recorded ${match[2].toLowerCase()} ${match[1]} with status “${match[3]}”.` : `Updated ${match[2].toLowerCase()} ${match[1]} to “${match[3]}”.`
 } else if(action==='Collection Follow-up Recorded' && parts.length>=2) {
  subject=parts[0];text=`Recorded a payment follow-up for ${parts[0]}: ${parts[1]}.${parts[2] ? ` Note: ${parts.slice(2).join(' — ')}.` : ''}`
 } else if(action==='Annual Penalty Posted' && (match=/^Property (\d+) — PHP ([\d.]+) at ([\d.]+)% on PHP ([\d.]+); anniversary (\d{4}-\d{2}-\d{2})/.exec(source))) {
  subject=accountLabel(context.properties?.get(match[1])) || 'Property account'
  text=`Added a ${match[3]}% annual late-payment penalty of ${displayMoney(match[2])} for ${subject}, based on ${displayMoney(match[4])} that remained unpaid. Penalty date: ${staffDate(match[5])}.`
 } else if(action==='Same-Day Annual Penalty Rate Override') {
  const fields=Object.fromEntries([...source.matchAll(/(?:^|\s)(classification|previous_rate|new_rate|effective)=([^\s]+)/g)].map(m=>[m[1],m[2]]))
  if(fields.new_rate) {subject='Annual penalty rate';text=`Changed the annual penalty rate for ${friendlyValue('property_classification',fields.classification)} properties from ${friendlyValue('previous_rate',fields.previous_rate)} to ${friendlyValue('new_rate',fields.new_rate)}, effective ${staffDate(fields.effective)}.`}
 }
 if(!text) {
  text=changeSentences(source) || stripInternal(source) || 'The action was recorded, but its description is unavailable.'
  subject=subject || stripInternal(legacy.subject || source) || 'Activity'
 }
 text=stripInternal(text).replace(/\.\./g,'.')
 return { action:label,subject:stripInternal(subject || legacy.subject || label),detail:text,text }
}

export async function loadStaffActivityContext(db, logs) {
 const ids=new Set(),receipts=new Set(),properties=new Set()
 for(const log of logs) {
  const text=String(log.target || '')
  for(const m of text.matchAll(/\b(?:OR|SR)-[\w-]+/g))receipts.add(m[0])
  for(const m of text.matchAll(/\bpayment\s+(\d+)\b/gi))ids.add(m[1])
  for(const m of text.matchAll(/\bproperty\s*[:=]?\s*(\d+)\b/gi))properties.add(m[1])
 }
 const context={paymentsById:new Map(),paymentsByReceipt:new Map(),properties:new Map()}
 async function read(table,column,values,select,consume) {
  const list=[...values]
  for(let i=0;i<list.length;i+=100) {
   try {const {data,error}=await db.from(table).select(select).in(column,list.slice(i,i+100));if(!error)for(const row of data || [])consume(row)} catch { /* The recorded action remains readable without lookups. */ }
  }
 }
 const payment=row=>{context.paymentsById.set(String(row.id),row);if(row.receipt_number)context.paymentsByReceipt.set(row.receipt_number,row)}
 await Promise.all([
  read('payments','id',ids,'id,receipt_number,homeowner_name,property_id,block_name,lot_number',payment),
  read('payments','receipt_number',receipts,'id,receipt_number,homeowner_name,property_id,block_name,lot_number',payment),
  read('properties','id',properties,'id,homeowner_name,block,lot_number',row=>context.properties.set(String(row.id),row)),
 ])
 return context
}

export function reversalDescription(row) {
 const amount=row.amount_formatted || 'The recorded amount'
 return /discount/i.test(row.kind || '') ? `The ${amount} discount was removed when the transaction was cancelled.`
  : /penalty/i.test(row.kind || '') ? `The ${amount} late-payment penalty was cancelled too.` : `${row.kind || 'Related amount'}: ${amount}.`
}

export function staffNotificationCopy(item) {
 const p=item.payload || {},account=accountLabel(p.accounts?.[0])
 let title=item.title || 'System update',body=''
 if(item.kind==='settings_changed' && Array.isArray(p.changes)) {
  title=p.changes.length===1 && p.changes[0].field==='price_per_sqm' ? 'Association dues rate changed' : 'System settings changed'
  body=p.changes.map(c=>{
   const before=String(c.before_formatted ?? friendlyValue(c.field,c.before)),after=String(c.after_formatted ?? friendlyValue(c.field,c.after))
   return c.field==='price_per_sqm' ? `The association dues rate changed from ${before.replace('/sqm','')} to ${after.replace('/sqm','')} per square meter.`
    : `${staffFieldLabel(c.field)} changed from ${friendlyValue(c.field,before)} to ${friendlyValue(c.field,after)}.`
  }).join(' ')
 } else if(item.kind==='settings_changed' && p.category && p.year) {
  title='Expense budget changed';body=`The ${p.category.toLowerCase()} expense budget for ${p.year} changed from ${displayMoney(p.before)} to ${displayMoney(p.after)}.${p.reason ? ` Reason: ${p.reason}.`:''}`
 } else if(item.kind==='settings_changed' && p.classification) {
  title='Annual penalty rate changed';body=`The annual penalty rate for ${friendlyValue('property_classification',p.classification)} properties changed from ${friendlyValue('annual_rate',p.before)} to ${friendlyValue('annual_rate',p.after)}, effective ${staffDate(p.effective_from)}.${p.reason ? ` Reason: ${p.reason}.`:''}`
 } else if(item.kind==='transaction_voided' && p.source_table) {
  const kind={payments:'payment',service_transactions:item.title?.includes('settlement')?'remaining service payment':'service payment',property_charges:'charge',balance_entries:'entered balance',expenses:'expense',account_adjustments:'balance adjustment'}[p.source_table] || 'transaction'
  title=`${kind.charAt(0).toUpperCase()+kind.slice(1)} cancelled`
  const reference=p.reference && !/^[0-9a-f-]{30,}$/i.test(String(p.reference)) && !/^\d+$/.test(String(p.reference)) ? ` ${p.reference}`:''
  body=`The ${kind}${reference}${p.amount_formatted ? ` for ${p.amount_formatted}`:''}${account ? ` on ${account}'s account`:''} was cancelled.${p.reason ? ` Reason: ${p.reason}.`:''}`
 } else if(item.kind==='credit_applied' && p.credit_used_formatted) {
  title='Advance credit used for monthly dues'
  const month=p.billing_month ? new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'long',year:'numeric'}).format(new Date(`${String(p.billing_month).slice(0,10)}T12:00:00+08:00`)) : 'monthly'
  body=`The system used ${p.credit_used_formatted} of advance credit${account ? ` from ${account}`:''} to pay ${month} association dues.`
 } else if(item.kind==='penalty_applied' && p.penalty_formatted) {
  title='Annual late-payment penalty added'
  body=`The system added a ${p.rate_formatted} late-payment penalty of ${p.penalty_formatted}${account ? ` for ${account}`:''}, based on ${p.base_formatted} that remained unpaid. Penalty date: ${staffDate(p.anniversary_date)}.${p.accounts?.[0]?.classification ? ` Property type: ${friendlyValue('property_classification',p.accounts[0].classification)}.` : ''}`
 } else if(item.kind==='ownership_changed') {
  title=/transfer/i.test(item.title || '')?'Property ownership transferred':p.new_status==='moved'?'Homeowner marked as moved out':'Homeowner details changed'
  body=stripInternal(item.body).replace(/ Account:.*$/,'').replace(/Block\s+Block\s+/gi,'Block ')
 } else if(item.kind==='collection_run' && p.credit_deducted_formatted) {
  title='Monthly dues collection update'
  body=`Advance credit paid ${p.credit_deducted_formatted} toward monthly dues for ${p.credit_accounts} property accounts: ${p.fully_covered} paid in full by credit and ${p.partly_covered} partly paid. ${p.unpaid_accounts} accounts without advance credit still owe ${p.unpaid_total_formatted}; ${p.overdue_accounts} already appear in Overdue Accounts at reporting time.${p.observed_on && p.collection_date && p.observed_on !== p.collection_date ? ` This delayed report shows unpaid and overdue accounts as of ${staffDate(p.observed_on)}.` : ''}`
 } else if(item.kind==='penalty_anniversary' && p.total_formatted) {
  title='Yearly late-payment penalties added';body=`The system added ${p.total_formatted} in yearly penalties to ${p.balances} unpaid balances: ${p.homeowners} homeowner balances, ${p.lot_owners} lot-owner balances and ${p.unclassified} not yet classified.${p.caught_up_balances ? ` This includes ${p.caught_up_balances} penalties for earlier anniversaries that the system caught up on.` : ''}`
 }
 if(item.kind==='collection_run' && item.body?.includes('Accounts billed before the snapshot are excluded')) body += ' Accounts billed before the balance check are excluded from the advance-credit totals.'
 if(!body)body=stripInternal(item.body).replace(/\s*Recorded by [^.]+\.?$/,'').replace(/linked penalty\/discount reversal\(s\)/gi,'related cancelled charges or removed discounts')
 return {title,body:body.replace(/\.\./g,'.'),related:(p.related_reversals || []).map(reversalDescription)}
}
