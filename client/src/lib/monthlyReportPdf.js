import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { comparisonTableRows, incomeTableRows } from './monthlyReportData'

const NAVY = [17, 42, 82]
const GRAY = [100, 116, 139]
const GRAY_LIGHT = [241, 245, 249]
const GREEN = [22, 163, 74]
const RED = [220, 38, 38]
const AMBER = [217, 119, 6]
const BORDER = [226, 232, 240]
const WHITE = [255, 255, 255]
const TEXT = [30, 41, 59]

// jsPDF's built-in "helvetica" font has no peso glyph (₱ renders as "±"),
// so amounts use a "PHP" prefix, which always renders correctly.
const pesoNumber = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (value) => `PHP ${pesoNumber.format(Number(value || 0))}`

const dateShort = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })
const dateTimeLong = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })
const ymd = (value) => dateShort.format(new Date(`${value}T12:00:00+08:00`))

const PAGE_W = 215.9 // Letter portrait, mm
const PAGE_H = 279.4
const MARGIN = 16
const CONTENT_TOP = 22
const BOTTOM_LIMIT = PAGE_H - 18
const CONFIDENTIALITY = 'Confidential — for PHILAM Village board, officers and property management. Contains aggregate figures only.'

/**
 * Builds the HOA Monthly Report PDF from an already-computed `report`
 * (see computeMonthlyReportData) so the PDF and the on-screen preview match exactly.
 *
 * @param {object} p
 * @param {object} p.report               - result of computeMonthlyReportData
 * @param {string} p.monthLabel           - e.g. "October 2026"
 * @param {string} [p.logoDataUrl]        - optional PNG/JPEG data URL for the cover
 * @param {string} [p.managementCommentary] - optional, manually entered
 */
export function buildMonthlyReportPdf({
  report,
  monthLabel,
  hoaName,
  hoaAddress,
  preparedBy,
  datePrepared,
  logoDataUrl = '',
  managementCommentary = '',
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const { kpis, meta } = report
  const orgName = hoaName || 'PHILAM Village'
  const generatedAt = dateTimeLong.format(report.asOf)
  const periodText = `${ymd(meta.periodStart)} – ${ymd(meta.periodEnd)}`
  const location = hoaAddress ? `${orgName}, ${hoaAddress}` : orgName

  // ---------- layout helpers ----------
  let y = 0
  const newPage = () => {
    doc.addPage('letter', 'portrait')
    return CONTENT_TOP
  }
  const ensureSpace = (needed) => {
    if (y + needed > BOTTOM_LIMIT) y = newPage()
  }

  function sectionTitle(num, label) {
    ensureSpace(34) // heading + at least the start of what follows
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(`${num}. ${label}`, MARGIN, y)
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.6)
    doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2)
    doc.setLineWidth(0.2)
    y += 10
  }

  function subheading(label) {
    ensureSpace(28)
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(label, MARGIN, y)
    y += 6
  }

  function paragraph(text, opts = {}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 9.5)
    const lines = doc.splitTextToSize(text, PAGE_W - MARGIN * 2)
    const lh = opts.lineHeight || 4.6
    ensureSpace(lines.length * lh + 2)
    doc.setTextColor(...(opts.color || TEXT))
    doc.text(lines, MARGIN, y)
    y += lines.length * lh + (opts.after ?? 2)
  }

  const note = (text) => paragraph(text, { size: 8, color: GRAY, after: 5 })
  const empty = (text) => paragraph(text, { size: 9, color: GRAY, after: 5 })

  function kpiCard(x, cardY, w, h, label, value, tone) {
    const toneColor = tone === 'good' ? GREEN : tone === 'bad' ? RED : tone === 'warn' ? AMBER : NAVY
    doc.setFillColor(...WHITE)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, cardY, w, h, 2, 2, 'FD')
    doc.setFillColor(...toneColor)
    doc.rect(x, cardY, w, 1.3, 'F')
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.text(doc.splitTextToSize(label.toUpperCase(), w - 8), x + 4, cardY + 7)
    doc.setTextColor(...toneColor)
    doc.setFontSize(value.length > 14 ? 10.5 : 12.5)
    doc.text(String(value), x + 4, cardY + h - 5)
  }

  function kpiRow(cards) {
    const cardW = (PAGE_W - MARGIN * 2 - 18) / 4
    const cardH = 25
    ensureSpace(cardH + 4)
    let kx = MARGIN
    cards.forEach((c) => {
      kpiCard(kx, y, cardW, cardH, c[0], c[1], c[2])
      kx += cardW + 6
    })
    y += cardH + 6
  }

  function table(head, body, opts = {}) {
    ensureSpace(24)
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: MARGIN, right: MARGIN, top: CONTENT_TOP, bottom: 18 },
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: TEXT, lineColor: BORDER, lineWidth: 0.15, overflow: 'linebreak' },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      ...opts,
    })
    y = doc.lastAutoTable.finalY + 7
  }

  const boldLast = (rows) => ({ didParseCell: (d) => { if (d.section === 'body' && d.row.index === rows.length - 1) d.cell.styles.fontStyle = 'bold' } })
  const rightAlign = (...cols) => Object.fromEntries(cols.map((c) => [c, { halign: 'right' }]))

  // ================= COVER PAGE =================
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F')

  let cursor = 62
  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl)
      const maxW = 52
      const maxH = 40
      const scale = Math.min(maxW / props.width, maxH / props.height)
      const w = props.width * scale
      const h = props.height * scale
      doc.setFillColor(...WHITE)
      doc.roundedRect(PAGE_W / 2 - w / 2 - 4, 44, w + 8, h + 8, 3, 3, 'F')
      doc.addImage(logoDataUrl, props.fileType || 'PNG', PAGE_W / 2 - w / 2, 48, w, h)
      cursor = 48 + h + 22
    } catch {
      cursor = 62
    }
  }
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.text(orgName, PAGE_W / 2, cursor, { align: 'center' })
  cursor += 14
  doc.setFontSize(20)
  doc.text('Homeowners Association', PAGE_W / 2, cursor, { align: 'center' })
  cursor += 9
  doc.text('Monthly Management Report', PAGE_W / 2, cursor, { align: 'center' })
  cursor += 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(14)
  doc.text(monthLabel, PAGE_W / 2, cursor, { align: 'center' })
  cursor += 7
  doc.setFontSize(10.5)
  doc.text(`Reporting period: ${periodText}`, PAGE_W / 2, cursor, { align: 'center' })
  cursor += 6
  doc.text(location, PAGE_W / 2, cursor, { align: 'center' })

  // Status pill
  cursor += 12
  doc.setFillColor(...AMBER)
  doc.roundedRect(PAGE_W / 2 - 38, cursor - 5, 76, 9, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(`STATUS: ${meta.status.toUpperCase()} — ${meta.reportType.toUpperCase()}`, PAGE_W / 2, cursor + 1, { align: 'center' })

  // Details
  cursor += 16
  doc.setDrawColor(...WHITE)
  doc.line(PAGE_W / 2 - 30, cursor - 6, PAGE_W / 2 + 30, cursor - 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const coverLines = [
    `Date generated: ${datePrepared}`,
    `Data cutoff: ${generatedAt} (Manila time)`,
    `Prepared by: ${preparedBy || 'HOA Management'}`,
    'Reviewed by: Not yet reviewed',
    'Approved by: Not yet approved',
  ]
  coverLines.forEach((line, i) => doc.text(line, PAGE_W / 2, cursor + i * 6, { align: 'center' }))

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(210, 220, 235)
  doc.text(doc.splitTextToSize(`${CONFIDENTIALITY} Figures are preliminary, unreconciled and unaudited unless stated otherwise.`, 150), PAGE_W / 2, 248, { align: 'center' })

  // ================= 1. EXECUTIVE SUMMARY =================
  y = newPage()
  sectionTitle('1', 'Executive Summary')
  const monthOnly = monthLabel.split(' ')[0]
  kpiRow([
    [`${monthOnly} income collected`, money(kpis.totalIncome), kpis.totalIncome > 0 ? 'good' : 'default'],
    [`${monthOnly} expenses recorded`, money(kpis.totalExpenses), 'default'],
    ['Net operating result', money(kpis.netIncome), kpis.netIncome >= 0 ? 'good' : 'bad'],
    ['Outstanding homeowner balances', money(kpis.totalOutstanding), kpis.totalOutstanding > 0 ? 'warn' : 'good'],
  ])
  kpiRow([
    ['Accounts with a balance', String(kpis.outstandingAccountCount), kpis.outstandingAccountCount > 0 ? 'warn' : 'good'],
    ['Overdue accounts', String(kpis.overdueAccountCount), kpis.overdueAccountCount > 0 ? 'bad' : 'good'],
    ['Completed events', String(kpis.completedEventCount), 'default'],
    ['Upcoming events', String(kpis.upcomingEventCount), 'default'],
  ])
  y += 2
  subheading('Management Summary')
  paragraph(
    `For ${periodText}, ${money(kpis.totalIncome)} in income was collected against ${money(kpis.totalExpenses)} in recorded expenses, a net operating ` +
    `${kpis.netIncome >= 0 ? 'surplus' : 'deficit'} of ${money(Math.abs(kpis.netIncome))}. ` +
    `${kpis.outstandingAccountCount} active account(s) carry a balance totalling ${money(kpis.totalOutstanding)} as of the data cutoff, of which ` +
    `${kpis.overdueAccountCount} account(s) are past their due date. ${kpis.completedEventCount} community event(s) were completed and ` +
    `${kpis.upcomingEventCount} are upcoming.`
  )
  note(
    'The net operating result is recorded income less recorded expenses. It is not cash on hand: unpaid dues are not counted as income, and cash and bank ' +
    'balances are not tracked in the system. Beginning/ending cash balances, collection rate, open maintenance requests, unresolved incidents and ongoing ' +
    'projects are not shown because the system does not record them. ' +
    `Data status: ${meta.dataStatus}.`
  )

  // ================= 2. FINANCIAL REPORT =================
  sectionTitle('2', 'Financial Report')
  subheading('2.1 Income Breakdown')
  const incomeRows = incomeTableRows(report.income, money)
  if (report.income.transactionCount === 0) {
    empty('No income records recorded for this period.')
  } else {
    table(['Revenue Category', 'Transactions', 'Amount'], incomeRows, { ...boldLast(incomeRows), columnStyles: rightAlign(1, 2) })
  }

  subheading('2.2 Expense Breakdown')
  if (report.expenses.byCategory.length) {
    const categoryRows = report.expenses.byCategory.map((c) => [c.category, String(c.count), money(c.amount)])
    categoryRows.push(['Total Expenses', String(report.expenses.entryCount), money(report.expenses.totalExpenses)])
    table(['Category', 'Transactions', 'Amount'], categoryRows, { ...boldLast(categoryRows), columnStyles: rightAlign(1, 2) })

    subheading('Expense Transactions')
    const itemRows = report.expenses.entries.map((e) => [
      ymd(e.expense_date),
      e.category,
      e.description || '—',
      e.reference_number || '—',
      e.recorded_by_name || '—',
      e.status || '—',
      money(e.amount),
    ])
    table(['Date', 'Category', 'Description', 'Reference No.', 'Recorded By', 'Status', 'Amount'], itemRows, {
      columnStyles: { 2: { cellWidth: 40 }, 6: { halign: 'right' } },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, textColor: TEXT, lineColor: BORDER, lineWidth: 0.15, overflow: 'linebreak' },
    })
    note('Voided expenses are excluded. Payment status other than the recorded status is not tracked.')
  } else {
    empty('No expenses recorded for this period.')
  }

  subheading('2.3 Cash and Bank Balances')
  empty('Not tracked in the system. Cash and bank account balances, transfers and bank reconciliation are not recorded, so no beginning or ending balance is reported.')

  subheading('2.4 Accounts Receivable and Collections')
  const rcv = report.receivables
  table(['Metric', 'Value'], [
    ['Billed for this period (all charge types)', money(rcv.billedTotal)],
    ['Collected this period — dues', money(rcv.duesIncome)],
    ['Collected this period — fees & charges', money(rcv.feesIncome)],
    ['Collected this period — amenity / service revenue', money(rcv.serviceIncome)],
    ['Total collected this period (all receipts)', money(rcv.totalCollected)],
    ['Outstanding balances, all charges (as of data cutoff)', money(rcv.totalOutstanding)],
    ['   of which overdue', money(rcv.overdueAmount)],
    ['   of which not yet due', money(rcv.notYetDueAmount)],
    ['Accounts with an outstanding balance', String(rcv.outstandingAccountCount)],
    ['Delinquent (overdue) accounts', String(rcv.overdueAccountCount)],
  ], { columnStyles: rightAlign(1) })

  if (rcv.billedByType.length) {
    subheading('Billed This Period, by Charge Type')
    table(['Charge Type', 'Charges', 'Amount'], rcv.billedByType.map((b) => [b.name, String(b.count), money(b.amount)]), { columnStyles: rightAlign(1, 2) })
  } else {
    empty('No charges were billed for this period.')
  }

  subheading('Aging of Overdue Balances')
  table(['Days Overdue', 'Accounts', 'Overdue Amount'], [
    ...rcv.aging.map((a) => [a.label, String(a.accounts), money(a.amount)]),
    ['Total overdue', String(rcv.overdueAccountCount), money(rcv.overdueAmount)],
  ], { ...boldLast(Array(rcv.aging.length + 1)), columnStyles: rightAlign(1, 2) })

  subheading('Collection Follow-ups This Period')
  if (rcv.collectionActionSummary.length) {
    table(['Follow-up Type', 'Count'], rcv.collectionActionSummary.map((a) => [a.name, String(a.count)]), { columnStyles: rightAlign(1) })
  } else {
    empty('No records recorded for this period.')
  }
  note(
    'Balances and aging are current as of the data cutoff, not a snapshot of the end of the reporting month. Aging places each account\'s overdue amount in the bucket of its oldest overdue charge. ' +
    'Collection rate is not calculated: receipts are not consistently allocated to billing months, so current-period collections cannot be separated from prior-period balances. ' +
    'Individual homeowner names and balances are withheld from this general report.'
  )

  subheading('2.5 Period Comparisons')
  if (report.comparisons.length) {
    table(
      ['Compared with', 'Income then', 'Income change', 'Expenses then', 'Expense change'],
      comparisonTableRows(report.comparisons, money),
      { columnStyles: rightAlign(1, 2, 3, 4) }
    )
    note('Change = this period minus the compared period. Percentages show "n/a" when the compared amount is zero, and no comparison is shown when that period has no records. Year-to-date totals are not included.')
  } else {
    empty('Comparison data was not loaded for this report.')
  }

  subheading('2.6 Accounts Payable and Budget Versus Actual')
  empty('Not tracked in the system. Supplier invoices (accounts payable) and an approved budget are not recorded, so neither is reported.')

  // ================= 3. COMMUNITY ACTIVITIES =================
  sectionTitle('3', 'Community Activities')
  const eventRow = (e) => [ymd(e.event_date), e.title, e.location || '—']
  subheading('Completed Events')
  if (report.events.completed.length) table(['Date', 'Event', 'Location'], report.events.completed.map(eventRow))
  else empty('No completed events recorded for this period.')

  if (report.events.today.length) {
    subheading('Scheduled for the Data Cutoff Date (not counted as completed)')
    table(['Date', 'Event', 'Location'], report.events.today.map(eventRow))
  }

  subheading('Upcoming Events')
  if (report.events.upcoming.length) table(['Date', 'Event', 'Location'], report.events.upcoming.map(eventRow))
  else empty('No upcoming events recorded.')
  note('Event status is based on the scheduled date compared with the data cutoff. Cancellations, actual dates held, attendance and event costs are not tracked, so completed events are counted by date only.')

  // ================= 4. DOCUMENTS =================
  sectionTitle('4', 'Supporting Documents')
  if (report.documents.thisMonth.length) {
    table(['Document', 'Category', 'Date Uploaded'], report.documents.thisMonth.map((d) => [d.title, d.category, dateShort.format(new Date(d.created_at))]))
  } else {
    empty('No documents recorded for this period.')
  }

  // ================= 5. NOT TRACKED =================
  sectionTitle('5', 'Areas Not Tracked in the System')
  note('These report areas need modules that PhilamLife does not have yet. They are left out rather than shown as zero.')
  table(['Area', 'Status'], report.untrackedModules.map((m) => [m, 'Not tracked in the system']))

  // ================= 6. COMMENTARY =================
  sectionTitle('6', 'Management Commentary and Recommended Actions')
  subheading('Calculated Facts (automatically generated from system records)')
  report.commentary.facts.forEach((f) => paragraph(`•  ${f}`, { after: 1.5 }))
  y += 3

  subheading('Suggested Actions (rule-based)')
  if (report.commentary.recommendations.length) {
    table(['Issue', 'Suggested action'], report.commentary.recommendations.map((r) => [r.issue, r.action]))
    note('Responsible role, priority and target date are not recorded in the system.')
  } else {
    empty('No actions were triggered by this period\'s figures.')
  }

  subheading('Management Commentary (manually entered)')
  if (managementCommentary.trim()) paragraph(managementCommentary.trim())
  else empty('No manual commentary was entered.')

  // ================= 7. REVIEW AND APPROVAL =================
  const approvalHeight = 62
  if (y + approvalHeight > BOTTOM_LIMIT) y = newPage()
  sectionTitle('7', 'Review and Approval')
  table(['Role', 'Name', 'Date'], [
    ['Prepared by', preparedBy || 'HOA Management', datePrepared],
    ['Reviewed by', 'Not yet reviewed', '—'],
    ['Approved by', 'Not yet approved', '—'],
  ])
  paragraph(`Report status: ${meta.status}. Approval status: Not approved.`, { bold: true, size: 9, after: 1 })
  note('The system has no approval workflow, so this report cannot be marked Approved or Final. It has not been audited, and no compliance status is claimed. Only figures in the system as of the data cutoff are included; nothing is estimated.')

  const sigW = (PAGE_W - MARGIN * 2 - 20) / 2
  ensureSpace(24)
  y += 10
  doc.setDrawColor(...NAVY)
  doc.line(MARGIN, y, MARGIN + sigW, y)
  doc.line(MARGIN + sigW + 20, y, MARGIN + sigW * 2 + 20, y)
  doc.setTextColor(...GRAY)
  doc.setFontSize(8.5)
  doc.text(`Prepared by${preparedBy ? ` — ${preparedBy}` : ''}`, MARGIN, y + 5)
  doc.text('Reviewed / Approved by', MARGIN + sigW + 20, y + 5)

  // ================= HEADERS AND FOOTERS (all pages after the cover) =================
  const total = doc.getNumberOfPages()
  for (let i = 2; i <= total; i += 1) {
    doc.setPage(i)
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, PAGE_W, 14, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(orgName, MARGIN, 9)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`Monthly Report — ${monthLabel} (${ymd(meta.periodStart)} – ${ymd(meta.periodEnd)})`, PAGE_W - MARGIN, 9, { align: 'right' })

    doc.setDrawColor(...BORDER)
    doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14)
    doc.setTextColor(...GRAY)
    doc.setFontSize(7)
    doc.text(`Generated ${generatedAt} · Status: ${meta.status} · Preliminary, unaudited`, MARGIN, PAGE_H - 9)
    doc.text(CONFIDENTIALITY, MARGIN, PAGE_H - 5.5)
    doc.setFontSize(7.5)
    doc.text(`Page ${i - 1} of ${total - 1}`, PAGE_W - MARGIN, PAGE_H - 9, { align: 'right' })
  }

  return doc
}