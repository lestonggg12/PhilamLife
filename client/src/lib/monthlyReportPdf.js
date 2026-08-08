import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const NAVY = [17, 42, 82]
const NAVY_SOFT = [230, 236, 245]
const GRAY = [100, 116, 139]
const GRAY_LIGHT = [241, 245, 249]
const GREEN = [22, 163, 74]
const RED = [220, 38, 38]
const AMBER = [217, 119, 6]
const BORDER = [226, 232, 240]
const WHITE = [255, 255, 255]

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
})

const money = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? 'N/A'
    : peso.format(Number(value))

const pct = (value) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? 'N/A'
    : `${Number(value).toFixed(1)}%`

const NA = 'N/A'

const PAGE_W = 215.9 // Letter portrait, mm
const PAGE_H = 279.4
const MARGIN = 16

/**
 * Builds and returns a jsPDF document for the HOA Monthly Report.
 * Only computes figures from the data actually supplied — anything the
 * current schema can't support is rendered as "N/A — Not Available".
 */
export function buildMonthlyReportPdf({
  monthLabel,
  hoaName,
  hoaAddress,
  preparedBy,
  datePrepared,
  payments = [],
  serviceTransactions = [],
  expenses = [],
  ledgerAccounts = [],
  documents = [],
  events = [],
  monthRange, // { startMs, endMs }
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })

  // ---------- Derived figures (real data only) ----------
  const inRange = (iso) => {
    const ms = new Date(iso).getTime()
    return ms >= monthRange.startMs && ms < monthRange.endMs
  }

  const monthlyDues = payments.filter((p) => p.status !== 'Voided' && inRange(p.paid_at))
  const monthlyServices = serviceTransactions.filter((t) => inRange(t.paid_at))
  const monthlyExpenses = expenses.filter((e) => e.status !== 'Voided' && inRange(`${e.expense_date}T12:00:00+08:00`))

  const duesIncome = monthlyDues.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
  const serviceIncome = monthlyServices.reduce((s, t) => s + Number(t.amount_paid || 0), 0)
  const totalIncome = duesIncome + serviceIncome
  const totalExpenses = monthlyExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const netIncome = totalIncome - totalExpenses

  const outstandingAccounts = ledgerAccounts.filter((a) => Number(a.balance) > 0)
  const totalOutstanding = outstandingAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)

  const allTimeCharged = ledgerAccounts.reduce((s, a) => s + Number(a.totalCharges || 0), 0)
  const allTimeCollected = ledgerAccounts.reduce((s, a) => s + Number(a.totalPaid || 0), 0)
  const overallCollectionRate = allTimeCharged > 0 ? (allTimeCollected / allTimeCharged) * 100 : null

  const expenseByCategory = new Map()
  monthlyExpenses.forEach((e) => {
    const cat = e.category || 'Uncategorized'
    expenseByCategory.set(cat, (expenseByCategory.get(cat) || 0) + Number(e.amount || 0))
  })

  const serviceByName = new Map()
  monthlyServices.forEach((t) => {
    const name = t.service_name || 'Other'
    serviceByName.set(name, (serviceByName.get(name) || 0) + Number(t.amount_paid || 0))
  })

  const monthEvents = events.filter((e) => inRange(`${e.event_date}T12:00:00+08:00`))
  const upcomingEvents = events
    .filter((e) => new Date(`${e.event_date}T00:00:00+08:00`).getTime() > monthRange.endMs - 1)
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    .slice(0, 6)

  const monthDocuments = documents.filter((d) => inRange(d.created_at))

  // ---------- Page chrome ----------
  let pageNum = 0
  function addHeaderFooter(title) {
    pageNum += 1
    // Header
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, PAGE_W, 14, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(hoaName || 'Homeowners Association', MARGIN, 9)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`Monthly Report — ${monthLabel}`, PAGE_W - MARGIN, 9, { align: 'right' })

    // Footer
    doc.setDrawColor(...BORDER)
    doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12)
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text('Prepared for informational purposes. Figures reflect system records only.', MARGIN, PAGE_H - 7)
    doc.text(`Page ${pageNum}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' })
    if (title) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
    }
  }

  function newPage() {
    doc.addPage('letter', 'portrait')
    addHeaderFooter()
  }

  function sectionTitle(num, label, y = 22) {
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(`${num}. ${label}`, MARGIN, y)
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.6)
    doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2)
    doc.setLineWidth(0.2)
    return y + 10
  }

  function subheading(label, y) {
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(label, MARGIN, y)
    return y + 6
  }

  function paragraph(text, y, opts = {}) {
    doc.setTextColor(...(opts.color || [30, 41, 59]))
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 9.5)
    const width = opts.width || PAGE_W - MARGIN * 2
    const lines = doc.splitTextToSize(text, width)
    doc.text(lines, MARGIN, y)
    return y + lines.length * (opts.lineHeight || 4.6)
  }

  function kpiCard(x, y, w, h, label, value, tone) {
    const toneColor = tone === 'good' ? GREEN : tone === 'bad' ? RED : tone === 'warn' ? AMBER : NAVY
    doc.setFillColor(...WHITE)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, y, w, h, 2, 2, 'FD')
    doc.setFillColor(...toneColor)
    doc.rect(x, y, w, 1.3, 'F')
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    const labelLines = doc.splitTextToSize(label.toUpperCase(), w - 6)
    doc.text(labelLines, x + 4, y + 7)
    doc.setTextColor(...toneColor)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12.5)
    doc.text(String(value), x + 4, y + h - 5)
  }

  function table(startY, head, body, opts = {}) {
    autoTable(doc, {
      startY,
      head: [head],
      body,
      margin: { left: MARGIN, right: MARGIN },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: [30, 41, 59], lineColor: BORDER, lineWidth: 0.15 },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      ...opts,
    })
    return doc.lastAutoTable.finalY
  }

  // ================= COVER PAGE =================
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F')
  doc.setFillColor(...WHITE)
  doc.roundedRect(PAGE_W / 2 - 22, 55, 44, 44, 3, 3, 'F')
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('HOA', PAGE_W / 2, 79, { align: 'center' })
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('Logo Placeholder', PAGE_W / 2, 84, { align: 'center' })

  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text('Homeowners Association', PAGE_W / 2, 125, { align: 'center' })
  doc.text('Monthly Report', PAGE_W / 2, 136, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(13)
  doc.text(monthLabel, PAGE_W / 2, 148, { align: 'center' })

  doc.setDrawColor(...WHITE)
  doc.line(PAGE_W / 2 - 30, 156, PAGE_W / 2 + 30, 156)

  doc.setFontSize(11)
  doc.text(hoaName || 'Homeowners Association', PAGE_W / 2, 168, { align: 'center' })
  if (hoaAddress) doc.text(hoaAddress, PAGE_W / 2, 174, { align: 'center' })

  doc.setFontSize(9.5)
  doc.text(`Prepared by: ${preparedBy || NA}`, PAGE_W / 2, 190, { align: 'center' })
  doc.text(`Date prepared: ${datePrepared}`, PAGE_W / 2, 196, { align: 'center' })

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(210, 220, 235)
  doc.text('Prepared for informational purposes only. Distribute to homeowners, board members, and property management.', PAGE_W / 2, 250, { align: 'center', maxWidth: 150 })

  // ================= EXECUTIVE SUMMARY =================
  newPage()
  let y = sectionTitle('1', 'Executive Summary')

  const cardW = (PAGE_W - MARGIN * 2 - 12) / 3
  const cardH = 22
  const gap = 6
  const kpis = [
    ['Total Monthly Income', money(totalIncome), totalIncome > 0 ? 'good' : 'default'],
    ['Total Monthly Expenses', money(totalExpenses), 'default'],
    ['Net Income / (Loss)', money(netIncome), netIncome >= 0 ? 'good' : 'bad'],
    ['Current Cash Balance', NA, 'default'],
    ['Reserve Fund Balance', NA, 'default'],
    ['Assessment Collection Rate (to date)', pct(overallCollectionRate), 'default'],
    ['Outstanding Homeowner Balances', money(totalOutstanding), totalOutstanding > 0 ? 'warn' : 'good'],
    ['Open Maintenance Requests', NA, 'default'],
    ['Open Violations', NA, 'default'],
  ]
  let kx = MARGIN
  let ky = y
  kpis.forEach((k, i) => {
    kpiCard(kx, ky, cardW, cardH, k[0], k[1], k[2])
    if ((i + 1) % 3 === 0) {
      kx = MARGIN
      ky += cardH + gap
    } else {
      kx += cardW + gap
    }
  })
  y = ky + (kpis.length % 3 === 0 ? 0 : cardH + gap) + 4

  y = subheading('Narrative Summary', y + 2)
  const narrative =
    `Overall financial condition: total income of ${money(totalIncome)} was recorded against total expenses of ${money(totalExpenses)}, ` +
    `resulting in a net ${netIncome >= 0 ? 'surplus' : 'deficit'} of ${money(Math.abs(netIncome))} for the period. ` +
    `Outstanding homeowner balances across the community total ${money(totalOutstanding)} as of report date. ` +
    `Major operational activities, maintenance work, incidents, capital projects, and board decisions for the period are ` +
    `Not Available in the system and are marked accordingly throughout this report. Community events on record for the period: ${monthEvents.length}.`
  y = paragraph(narrative, y)

  y += 4
  doc.setFillColor(...GRAY_LIGHT)
  doc.roundedRect(MARGIN, y, PAGE_W - MARGIN * 2, 16, 2, 2, 'F')
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.text('Legend:  Green = favorable / completed    Amber = attention required    Red = issue / overdue', MARGIN + 4, y + 6)
  doc.setFont('helvetica', 'normal')
  doc.text('Sections without a corresponding data source in the system are marked "N/A — Not Available" rather than estimated.', MARGIN + 4, y + 11)

  // ================= 2. FINANCIAL REPORT =================
  newPage()
  y = sectionTitle('2', 'Financial Report')
  y = subheading('2.1 Income / Revenue', y)

  const incomeRows = [
    ['Homeowner Assessments (Dues)', NA, money(duesIncome), NA],
    ...Array.from(serviceByName.entries()).map(([name, amt]) => [`Amenity / Service — ${name}`, NA, money(amt), NA]),
    ['Late Fees', NA, NA, NA],
    ['Fines / Penalties', NA, NA, NA],
    ['Other Income', NA, NA, NA],
  ]
  incomeRows.push(['Total Income', NA, money(totalIncome), NA])
  y = table(y, ['Revenue Category', 'Budget', 'Actual', 'Variance'], incomeRows, {
    didParseCell: (d) => {
      if (d.row.index === incomeRows.length - 1) d.cell.styles.fontStyle = 'bold'
    },
  }) + 8

  y = subheading('2.2 Expenses', y)
  const expenseCategoryOrder = ['Landscaping', 'Security', 'Utilities', 'Repairs & Maintenance', 'Administrative', 'Insurance', 'Staff / Payroll']
  const seen = new Set()
  const expenseRows = []
  expenseCategoryOrder.forEach((cat) => {
    if (expenseByCategory.has(cat)) {
      expenseRows.push([cat, NA, money(expenseByCategory.get(cat)), NA])
      seen.add(cat)
    }
  })
  expenseByCategory.forEach((amt, cat) => {
    if (!seen.has(cat)) expenseRows.push([cat, NA, money(amt), NA])
  })
  if (expenseRows.length === 0) expenseRows.push(['No expense records for this period', NA, money(0), NA])
  expenseRows.push(['Total Expenses', NA, money(totalExpenses), NA])
  y = table(y, ['Expense Category', 'Budget', 'Actual', 'Variance'], expenseRows, {
    didParseCell: (d) => {
      if (d.row.index === expenseRows.length - 1) d.cell.styles.fontStyle = 'bold'
    },
  }) + 8

  if (y > PAGE_H - 60) { newPage(); y = 22 }
  y = subheading('2.3 Budget vs. Actual', y)
  y = paragraph('No budget module is configured in the system, so budget figures and variances are shown as N/A. Actual income and expense totals above are drawn directly from posted transactions for the period.', y)

  y += 8
  y = subheading('2.4 Balance Sheet / Financial Position', y)
  y = table(y, ['Assets', 'Amount'], [
    ['Operating Cash', NA],
    ['Reserve Cash', NA],
    ['Accounts Receivable', money(totalOutstanding)],
    ['Other Assets', NA],
  ]) + 6
  y = table(y, ['Liabilities', 'Amount'], [
    ['Accounts Payable', NA],
    ['Accrued Expenses', NA],
    ['Other Liabilities', NA],
  ]) + 6
  y = table(y, ['Fund Balances', 'Amount'], [
    ['Operating Fund', NA],
    ['Reserve Fund', NA],
    ['Other Funds', NA],
  ]) + 4
  y = paragraph('A full balance sheet requires opening bank balances and a general ledger close, which are not tracked in the current system.', y, { size: 8, color: GRAY })

  // ================= 2.5 / 2.6 =================
  newPage()
  y = 22
  y = subheading('2.5 Accounts Receivable / Collections', y)
  y = table(y, ['Metric', 'Value'], [
    ['Total assessments billed (all time)', money(allTimeCharged || null)],
    ['Total assessments collected (all time)', money(allTimeCollected || null)],
    ['Overall collection rate', pct(overallCollectionRate)],
    ['Outstanding homeowner balances (aggregate)', money(totalOutstanding)],
    ['Number of delinquent accounts', String(outstandingAccounts.length)],
    ['Amount collected this period (dues)', money(duesIncome)],
  ]) + 4
  y = paragraph('Aggregate figures only — individual homeowner names and balances are withheld from this general report.', y, { size: 8, color: GRAY })

  y += 8
  y = subheading('2.6 Reserve Fund', y)
  y = table(y, ['Reserve Fund Activity', 'Amount'], [
    ['Beginning Balance', NA],
    ['Monthly Contributions', NA],
    ['Interest / Other Income', NA],
    ['Withdrawals', NA],
    ['Ending Balance', NA],
  ]) + 4
  y = paragraph('Reserve fund balances are not yet tracked separately in the system; a dedicated reserve ledger is needed to populate this section.', y, { size: 8, color: GRAY })

  // ================= 3. MAINTENANCE =================
  newPage()
  y = sectionTitle('3', 'Maintenance & Facilities Report')
  y = table(y, ['Metric', 'Value'], [
    ['Total maintenance requests received', NA],
    ['Requests completed', NA],
    ['Requests still open', NA],
    ['Average resolution time', NA],
    ['Emergency repairs', NA],
    ['Routine maintenance', NA],
  ]) + 6
  y = table(y, ['Maintenance Item', 'Status', 'Cost', 'Date', 'Notes'], [
    ['Not Available', 'Not Available', NA, NA, 'No maintenance-request module is currently connected to this report.'],
  ]) + 4
  y = paragraph('This section will populate once a maintenance-request tracking module is added to the system.', y, { size: 8, color: GRAY })

  // ================= 4. ADMINISTRATIVE =================
  newPage()
  y = sectionTitle('4', 'Administrative & Management Report')
  y = table(y, ['Metric', 'Value'], [
    ['Board meetings held', NA],
    ['Homeowner requests received', NA],
    ['Homeowner requests resolved', NA],
    ['Notices issued', NA],
    ['Contracts renewed', NA],
    ['Vendor changes', NA],
    ['Policies reviewed or updated', NA],
    ['Documents added to library this period', String(monthDocuments.length)],
    ['Community/board events on calendar this period', String(monthEvents.length)],
  ]) + 4
  y = paragraph('Board-meeting and homeowner-request tracking are not yet captured as structured data in the system.', y, { size: 8, color: GRAY })

  // ================= 5. VIOLATIONS =================
  newPage()
  y = sectionTitle('5', 'Violations & Compliance')
  y = table(y, ['Category', 'New', 'Resolved', 'Outstanding'], [
    ['Property Maintenance', NA, NA, NA],
    ['Parking', NA, NA, NA],
    ['Noise', NA, NA, NA],
    ['Architectural', NA, NA, NA],
    ['Other', NA, NA, NA],
  ]) + 6
  y = table(y, ['Metric', 'Value'], [
    ['Fines assessed', NA],
    ['Fines collected', NA],
    ['Architectural applications approved', NA],
    ['Architectural applications pending', NA],
    ['Architectural applications rejected', NA],
  ]) + 4
  y = paragraph('No violations/compliance module is currently connected to this report.', y, { size: 8, color: GRAY })

  // ================= 6. SECURITY =================
  newPage()
  y = sectionTitle('6', 'Security & Incident Report')
  y = table(y, ['Date', 'Incident Type', 'Location', 'Status', 'Action Taken'], [
    [NA, 'Not Available', NA, NA, 'No security/incident tracking module is currently connected to this report.'],
  ]) + 4

  // ================= 7. COMMUNITY ACTIVITIES =================
  newPage()
  y = sectionTitle('7', 'Community Activities')
  const eventRows = monthEvents.length
    ? monthEvents.map((e) => [e.event_date, e.title, e.location || NA, NA])
    : [[NA, 'No community events on record for this period', NA, NA]]
  y = table(y, ['Date', 'Event', 'Location', 'Attendance'], eventRows) + 8
  y = subheading('Upcoming Events', y)
  const upcomingRows = upcomingEvents.length
    ? upcomingEvents.map((e) => [e.event_date, e.title, e.location || NA])
    : [[NA, 'No upcoming events on record', NA]]
  y = table(y, ['Date', 'Event', 'Location'], upcomingRows) + 4

  // ================= 8. CAPITAL PROJECTS =================
  newPage()
  y = sectionTitle('8', 'Capital Projects')
  y = table(y, ['Project', 'Budget', 'Spent', 'Progress', 'Status', 'Expected Completion'], [
    ['Not Available', NA, NA, NA, NA, NA],
  ]) + 4
  y = paragraph('No capital-projects module is currently connected to this report. Add project tracking to populate budgets, spend, and completion status here.', y, { size: 8, color: GRAY })

  // ================= 9. KPIs =================
  newPage()
  y = sectionTitle('9', 'Key Performance Indicators')
  y = table(y, ['KPI', 'Current Month', 'Previous Month', 'Change'], [
    ['Assessment Collection Rate (to date)', pct(overallCollectionRate), NA, NA],
    ['Budget Utilization', NA, NA, NA],
    ['Maintenance Completion Rate', NA, NA, NA],
    ['Avg. Maintenance Resolution Time', NA, NA, NA],
    ['Open Violations', NA, NA, NA],
    ['Open Maintenance Requests', NA, NA, NA],
    ['Reserve Fund Balance', NA, NA, NA],
    ['Community Events Held', String(monthEvents.length), NA, NA],
    ['Homeowner Requests', NA, NA, NA],
  ]) + 4
  y = paragraph('Month-over-month comparisons require the prior month\u2019s report data; only current-period figures available in the system are shown.', y, { size: 8, color: GRAY })

  // ================= 10 & 11 =================
  newPage()
  y = sectionTitle('10', 'Board Action Items')
  y = table(y, ['Action Item', 'Priority', 'Responsible Party', 'Due Date', 'Status'], [
    ['Not Available', NA, NA, NA, NA],
  ]) + 8

  y = sectionTitle('11', 'Upcoming Activities & Deadlines', y + 2)
  const deadlineRows = upcomingEvents.length
    ? upcomingEvents.map((e) => [e.event_date, e.title, 'Community Event'])
    : [[NA, 'No upcoming items on record', NA]]
  y = table(y, ['Date', 'Item', 'Type'], deadlineRows) + 4

  // ================= 12. DOCUMENTS =================
  newPage()
  y = sectionTitle('12', 'Documents & Supporting Information')
  const docRows = monthDocuments.length
    ? monthDocuments.map((d) => [d.title, d.category, new Date(d.created_at).toLocaleDateString('en-PH')])
    : [['Monthly Financial Statement', 'Not Attached', ''], ['Income & Expense Statement', 'Not Attached', ''], ['Balance Sheet', 'Not Attached', ''], ['Board Meeting Minutes', 'Not Attached', '']]
  y = table(y, ['Document', 'Category', 'Date Added'], docRows) + 4

  // ================= 13. COMMENTARY =================
  newPage()
  y = sectionTitle('13', 'Final Management Commentary')
  const commentary =
    `Financial condition: the association recorded ${money(totalIncome)} in income against ${money(totalExpenses)} in expenses this period, ` +
    `a net ${netIncome >= 0 ? 'surplus' : 'deficit'} of ${money(Math.abs(netIncome))}. Outstanding homeowner balances stand at ${money(totalOutstanding)}. ` +
    `Operational performance, maintenance condition, compliance situation, and major risks cannot be assessed from currently tracked data and are marked N/A above. ` +
    `Community activity on record for the period totals ${monthEvents.length} event(s). ` +
    `Priorities for next month should include closing the data gaps noted throughout this report (maintenance, violations, incidents, capital projects, and reserve-fund tracking) ` +
    `so future reports can be generated with complete figures.`
  y = paragraph(commentary, y)

  y += 10
  doc.setDrawColor(...BORDER)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 8
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY)
  y = paragraph('This report is prepared for informational purposes only, based solely on records available in the PhilamLife system as of the date prepared. No figures have been estimated or fabricated; unavailable data is disclosed as such.', y, { size: 8, color: GRAY })

  return doc
}