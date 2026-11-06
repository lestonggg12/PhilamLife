import { grievanceRows } from './monthlyReportData'
import { budgetComparison } from './expenseBudget'

// A report never converts absent monetary data to zero.  Monetary values
// are summed as integer centavos to avoid floating-point report drift.
const cents = (value) => {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim())
  if (!match) throw Error('A required amount is missing or invalid; report figures cannot be verified.')
  const amount = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'))
  if (!Number.isSafeInteger(amount)) throw Error('A report amount exceeds the supported range.')
  return match[1] === '-' ? -amount : amount
}
const php = (value) => `PHP ${(value / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const label = (value) => String(value ?? '').trim() || 'Not recorded'
const date = (value) => String(value || '').slice(0, 10) || 'Not recorded'
const sum = (rows, field) => rows.reduce((total, row) => total + cents(row[field]), 0)
const table = (title, head, rows) => ({ title, head, rows })
const section = (title, intro, tables = [], note = '') => ({ title, intro, tables, note })
const grouped = (rows, key, amount) => {
  const groupedRows = new Map()
  for (const entry of rows) {
    const name = label(entry[key])
    const current = groupedRows.get(name) || { count: 0, amount: 0 }
    current.count += 1
    current.amount += cents(entry[amount])
    groupedRows.set(name, current)
  }
  return [...groupedRows].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => [name, String(value.count), php(value.amount)])
}
const byMonth = (value, month) => String(value || '').slice(0, 7) === month
const meetingTitle = (name) => /\b(meeting|assembly|agm|board session)\b/i.test(name || '')
const isCategory = (doc, category) => String(doc.category || '').toLowerCase() === category.toLowerCase()

export function secretaryRoleReport({ month, events, documents, properties, grievances }) {
  if (![events, documents, properties].every(Array.isArray) || !grievances || !month) {
    throw Error('Secretary report source records are incomplete.')
  }
  const status = grievanceRows(grievances)
  if (status.some(([, val]) => !/^\d+$/.test(String(val)))) {
    throw Error('The grievance status summary is incomplete.')
  }
  const minutes = documents.filter(d => isCategory(d, 'Minutes'))
  const notices = documents.filter(d =>
    isCategory(d, 'Announcements') || isCategory(d, 'Legal') || /notice|letter|filing|correspondence/i.test(d.title || ''))
  const meetings = events.filter(e => meetingTitle(e.title))
  const newlyRegistered = properties.filter(p => byMonth(p.created_at, month))
  const statusUpdated = properties.filter(p => byMonth(p.status_updated_at, month))
  const custodyCounts = [...documents.reduce((map, doc) =>
    map.set(label(doc.category), (map.get(label(doc.category)) || 0) + 1), new Map())]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => [category, String(count)])
  const updatedList = (rows, timeKey) => rows.map(p => [
    label(p.block), label(p.lot_number), label(p.homeowner_name),
    label(p.homeowner_status), date(p[timeKey]),
  ])

  return {
    title: 'Monthly Secretary Report',
    context: 'Administrative and record-keeping review. Document uploads and registry timestamps are evidence of recorded activity, not proof that meetings, filings, title transfers, or resolutions were formally completed.',
    metrics: [
      ['Minutes uploaded', String(minutes.length)],
      ['Registry additions', String(newlyRegistered.length)],
      ['Status updates', String(statusUpdated.length)],
      ['Grievances received', String(grievances.received)],
    ],
    sections: [
      section('1. Meeting Minutes',
        'Documents filed under Minutes during the reporting month, alongside meetings recorded in the event calendar.', [
          table('Minutes uploaded', ['Document', 'Uploaded'], minutes.map(d => [label(d.title), date(d.created_at)])),
          table('Meetings on calendar', ['Date', 'Meeting', 'Location'], meetings.map(e => [date(e.event_date), label(e.title), label(e.location)])),
        ], 'Review, reading, accuracy checks and formal approval of minutes are not tracked as structured workflow statuses.'),
      section('2. Correspondence and Notices',
        'Legal and announcement documents filed in the library, and other titles matching correspondence terms.', [
          table('Correspondence and notice records', ['Document', 'Category', 'Uploaded'],
            notices.map(d => [label(d.title), label(d.category), date(d.created_at)])),
        ], 'The app does not reliably distinguish incoming from outgoing letters, prove DHSUD submission, or verify whether notices were formally served.'),
      section('3. Membership and Roster Updates',
        'New property registry entries and records with status-update timestamps in the period. These are not confirmed property-title transfers.', [
          table('Newly registered records', ['Block', 'Lot', 'Registered name', 'Current status', 'Created'],
            updatedList(newlyRegistered, 'created_at')),
          table('Records with status updates', ['Block', 'Lot', 'Registered name', 'Current status', 'Updated'],
            updatedList(statusUpdated, 'status_updated_at')),
        ], 'Former and new owners, title transfers, registered proxies and member voting eligibility require a dedicated auditable registry; they cannot be inferred from the current record.'),
      section('4. Pending Actions and Resolutions',
        'Follow-up on board resolutions, committee assignments and project decisions.', [],
        'Not tracked in a structured resolutions/action-items register. No outstanding actions or approved resolutions can be certified from the existing data.'),
      section('5. Custodianship of Records',
        'Document Library entries uploaded in the reporting period, grouped by recorded category.', [
          table('Archive activity by category', ['Document category', 'Uploads'], custodyCounts),
          table('Documents added', ['Title', 'Category', 'Uploaded'],
            documents.map(d => [label(d.title), label(d.category), date(d.created_at)])),
          table('Grievance recordkeeping summary', ['Measure', 'Cases'], status),
        ], 'Secure custody, completeness of the book of minutes, bylaws, articles of incorporation, corporate registry and official retention compliance require manual verification. Confidential grievance case details are omitted.'),
    ],
    basis: 'Sources: Document Library upload dates and categories, Event Calendar, current property registry with creation/status-update timestamps, and aggregated grievance RPC. Historical membership transitions and approval records are not reconstructed.',
  }
}

export function treasurerRoleReport({ month, payments, services, expenses, properties, overdue, collectionActions, snapshotDate, budgets }) {
  if (![payments, services, expenses, properties, overdue, collectionActions, budgets].every(Array.isArray) || !month) {
    throw Error('Treasurer report source records are incomplete.')
  }
  const propertyById = new Map(properties.map(p => [String(p.id), p]))
  if (propertyById.size !== properties.length) throw Error('Duplicate property records prevent a reliable delinquency report.')
  const overdueById = new Set()
  for (const r of overdue) {
    const id = String(r.property_id)
    if (overdueById.has(id)) throw Error('Duplicate overdue summary rows prevent a reliable report.')
    overdueById.add(id)
  }
  for (const p of properties) {
    if ((p.homeowner_status || 'active') === 'active' && !overdueById.has(String(p.id))) {
      throw Error('The receivables snapshot is missing an active property.')
    }
  }
  const paid = sum(payments, 'amount_paid')
  const serviceRevenue = sum(services, 'amount_paid')
  const expenseTotal = sum(expenses, 'amount')
  const revenue = paid + serviceRevenue
  const net = revenue - expenseTotal
  const unpaid = overdue.filter(r => r.is_overdue && (propertyById.get(String(r.property_id))?.homeowner_status || 'active') === 'active')
  if (unpaid.some(r => !r.aging_complete || r.days_overdue == null || r.overdue_amount == null)) {
    throw Error('Overdue aging is incomplete. A verified delinquency list cannot be generated.')
  }
  const overdueTotal = sum(unpaid, 'overdue_amount')
  const aging = [
    ['1–30 days', unpaid.filter(r => r.days_overdue >= 1 && r.days_overdue <= 30)],
    ['31–60 days', unpaid.filter(r => r.days_overdue >= 31 && r.days_overdue <= 60)],
    ['61–90 days', unpaid.filter(r => r.days_overdue >= 61 && r.days_overdue <= 90)],
    ['91+ days', unpaid.filter(r => r.days_overdue >= 91)],
  ].map(([range, rows]) => [range, String(rows.length), php(sum(rows, 'overdue_amount'))])
  const categoryExpenses = grouped(expenses, 'category', 'amount')
  const expenseBudget = budgetComparison(expenses, budgets, month, cents, php)
  const followups = collectionActions.map(a => {
    const property = propertyById.get(String(a.property_id))
    return [date(a.action_date), label(property?.block), label(property?.lot_number), label(a.action_type)]
  })
  const overdueList = [...unpaid].sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0))
    .map(r => {
      const p = propertyById.get(String(r.property_id))
      return [label(p?.block), label(p?.lot_number), label(p?.homeowner_name), p?.property_classification === 'lot_owner' ? 'Lot Owner' : p?.property_classification === 'homeowner' ? 'Homeowner' : 'Unclassified', String(r.days_overdue), php(cents(r.overdue_amount))]
    })
  return {
    title: 'Monthly Treasurer Report',
    context: 'Financial and fiduciary review. Monthly receipts and recorded expenses are not equivalent to verified cash or bank balances; aging is a current snapshot, not a historical month-end balance.',
    metrics: [
      ['Recorded receipts', php(revenue)],
      ['Expenses', php(expenseTotal)],
      [net < 0 ? 'Net deficit' : 'Net surplus', php(Math.abs(net))],
      ['Overdue now', php(overdueTotal)],
    ],
    sections: [
      section('1. Cash Position and Balances',
        'A cash position requires opening cash, operating bank balances and reserve balances, reconciled to their source statements.', [
          table('Cash position verification', ['Account or balance', 'Verified closing balance'], [
            ['Opening cash-on-hand', 'Not recorded'],
            ['Operating bank (checking/savings)', 'Not recorded'],
            ['Reserve fund account', 'Not recorded'],
            ['Net recorded monthly receipts less expenses (not a cash balance)', php(net)],
          ]),
        ], 'The app has transaction records but no verified opening cash balance or account statement balances. Do not treat net movement as cash-on-hand.'),
      section('2. Income Summary',
        'Recorded non-voided receipts for the reporting month, including association dues and service transactions.', [
          table('Association and other homeowner collections', ['Charge type', 'Receipts', 'Amount'],
            grouped(payments.map(p => ({ ...p, charge_type: p.charge_type || 'Association Dues' })), 'charge_type', 'amount_paid')),
          table('Amenity and service collections', ['Service', 'Receipts', 'Amount'], grouped(services, 'service_name', 'amount_paid')),
          table('Income totals', ['Source', 'Amount'], [
            ['Homeowner collections', php(paid)], ['Amenity/service receipts', php(serviceRevenue)], ['Total recorded receipts', php(revenue)],
          ]),
        ], 'Interest income and other receipts are included only if entered in an available transaction category; no missing income category is assumed to have zero revenue.'),
      section('3. Expense Summary and Disbursements',
        'Non-voided expense records dated within the selected reporting period.', [
          table('Expense categories', ['Category', 'Entries', 'Amount'], categoryExpenses),
          table('Itemized disbursements', ['Date', 'Category', 'Description', 'Reference', 'Amount'],
            expenses.map(e => [date(e.expense_date), label(e.category), label(e.description), label(e.reference_number), php(cents(e.amount))])),
          table('Period summary', ['Measure', 'Amount'], [['Total recorded expenses', php(expenseTotal)], ['Net receipts less expenses', php(net)]]),
        ], 'Expense entries are not proof of bank clearance. Authorization and vendor settlement status should be checked against supporting documentation.'),
      section('4. Budget vs. Actual Comparison',
        'Monthly actual expenses against Admin-approved calendar-year allocations, distributed across the twelve months. Positive variance is underspending; negative variance is overspending.', [
          table('Actual expenses against monthly approved allocation', ['Category', 'Monthly allocation', 'Actual', 'Variance'], expenseBudget.rows),
        ], expenseBudget.complete ? 'All compared categories have recorded approved annual allocations. Monthly amounts are a pro-rata allocation, not a month-specific board-approved budget.' : 'Some categories lack an approved annual allocation. Their variances and the overall variance cannot be verified; an absent budget is not treated as zero.'),
      section('5. Delinquency Report',
        `Current receivables snapshot as of ${snapshotDate || 'report generation'}. This section is not a reconstruction of balances at the end of the selected month.`, [
          table('Overdue account aging', ['Age', 'Accounts', 'Overdue amount'], aging),
          table('Overdue active accounts — confidential', ['Block', 'Lot', 'Registered name', 'Classification', 'Days overdue', 'Overdue amount'], overdueList),
          table('Recorded collection follow-ups during period', ['Date', 'Block', 'Lot', 'Action'], followups),
        ], 'Restricted to authorized association staff. The detailed list contains registered homeowner names. A current property view cannot prove a historical delinquency position or an old membership status.'),
      section('6. Accounts Payable and Reconciliations',
        'Vendor bills and bank reconciliation are separate from expense/payment transactions.', [
          table('Verification checklist', ['Review item', 'Status'], [
            ['Outstanding vendor/supplier bills', 'Dedicated payable ledger not available'],
            ['Bank reconciliation to statements', 'No verified reconciliation status recorded'],
            ['Reserve account reconciliation', 'No verified reconciliation status recorded'],
          ]),
        ], 'No payables balance or reconciliation completion is asserted. Review independently maintained statements and supplier records before approval.'),
    ],
    basis: 'Sources: non-voided payments, service transactions and expenses within the selected Manila reporting month; current active property and overdue-aging views; collection action log for the month. All financial amounts are computed from actual stored entries. Approved annual expense budgets are sourced from the Admin budget register and allocated one-twelfth per month with centavo precision. No bank balance or payable figure is inferred.',
  }
}
