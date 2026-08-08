import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeMonthlyReportData } from './monthlyReportData'

const NAVY = [17, 42, 82]
const GRAY = [100, 116, 139]
const GRAY_LIGHT = [241, 245, 249]
const GREEN = [22, 163, 74]
const RED = [220, 38, 38]
const AMBER = [217, 119, 6]
const BORDER = [226, 232, 240]
const WHITE = [255, 255, 255]

// jsPDF's built-in "helvetica" font only supports WinAnsi encoding, which
// does not include the Philippine peso glyph (₱) — rendering it corrupts to
// "±". Use a plain "PHP" prefix instead, which is always safe to render.
const pesoNumber = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (value) => `PHP ${pesoNumber.format(Number(value || 0))}`

const dateShort = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })

const PAGE_W = 215.9 // Letter portrait, mm
const PAGE_H = 279.4
const MARGIN = 16
const BOTTOM_LIMIT = PAGE_H - 18

/**
 * Builds and returns a jsPDF document for the HOA Monthly Report.
 * Content flows continuously across pages (no forced page-break per
 * section) — a new page is only started when the next block genuinely
 * doesn't fit, so short reports stay compact instead of one section per page.
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
  month,
}) {
  const data = computeMonthlyReportData({ payments, serviceTransactions, expenses, ledgerAccounts, documents, events, month })
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })

  let pageNum = 0
  function addHeaderFooter() {
    pageNum += 1
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, PAGE_W, 14, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(hoaName || 'Homeowners Association', MARGIN, 9)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(`Monthly Report — ${monthLabel}`, PAGE_W - MARGIN, 9, { align: 'right' })

    doc.setDrawColor(...BORDER)
    doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12)
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text('Prepared for informational purposes. Figures reflect system records only.', MARGIN, PAGE_H - 7)
    doc.text(`Page ${pageNum}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' })
  }

  function newPage() {
    doc.addPage('letter', 'portrait')
    addHeaderFooter()
    return 22
  }

  // Starts a new page only if `needed` mm of vertical space isn't left.
  let y = 0
  function ensureSpace(needed) {
    if (y + needed > BOTTOM_LIMIT) y = newPage()
  }

  function sectionTitle(num, label) {
    ensureSpace(20)
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
    ensureSpace(16)
    doc.setTextColor(...NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(label, MARGIN, y)
    y += 6
  }

  function paragraph(text, opts = {}) {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size || 9.5)
    const width = opts.width || PAGE_W - MARGIN * 2
    const lines = doc.splitTextToSize(text, width)
    ensureSpace(lines.length * (opts.lineHeight || 4.6) + 2)
    doc.setTextColor(...(opts.color || [30, 41, 59]))
    doc.text(lines, MARGIN, y)
    y += lines.length * (opts.lineHeight || 4.6)
  }

  function kpiCard(x, cardY, w, h, label, value, tone) {
    const toneColor = tone === 'good' ? GREEN : tone === 'bad' ? RED : tone === 'warn' ? AMBER : NAVY
    doc.setFillColor(...WHITE)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, cardY, w, h, 2, 2, 'FD')
    doc.setFillColor(...toneColor)
    doc.rect(x, cardY, w, 1.3, 'F')
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    const labelLines = doc.splitTextToSize(label.toUpperCase(), w - 8)
    doc.text(labelLines, x + 5, cardY + 8)
    doc.setTextColor(...toneColor)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(String(value), x + 5, cardY + h - 6)
  }

  function table(head, body, opts = {}) {
    ensureSpace(20)
    let firstPage = true
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: MARGIN, right: MARGIN, bottom: 18 },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: [30, 41, 59], lineColor: BORDER, lineWidth: 0.15 },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
      alternateRowStyles: { fillColor: GRAY_LIGHT },
      didDrawPage: () => {
        // autoTable calls this once per page it renders. The current page
        // already has our header/footer (added by newPage()/ensureSpace
        // before this table started) — only add chrome for pages autoTable
        // itself had to break onto internally.
        if (firstPage) { firstPage = false; return }
        addHeaderFooter()
      },
      ...opts,
    })
    y = doc.lastAutoTable.finalY + 8
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
  doc.text(`Prepared by: ${preparedBy || 'HOA Management'}`, PAGE_W / 2, 190, { align: 'center' })
  doc.text(`Date prepared: ${datePrepared}`, PAGE_W / 2, 196, { align: 'center' })

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(210, 220, 235)
  doc.text('Prepared for informational purposes only. Distribute to homeowners, board members, and property management.', PAGE_W / 2, 250, { align: 'center', maxWidth: 150 })

  // ================= CONTENT (flows continuously) =================
  y = newPage()

  // ---- 1. Executive Summary ----
  sectionTitle('1', 'Executive Summary')

  const { kpis } = data
  const monthOnly = monthLabel.split(' ')[0]
  const cardW = (PAGE_W - MARGIN * 2 - 18) / 4
  const cardH = 27
  const cards = [
    [`Total ${monthOnly} Revenue`, money(kpis.totalIncome), kpis.totalIncome > 0 ? 'good' : 'default'],
    [`Total ${monthOnly} Expenditures`, money(kpis.totalExpenses), 'default'],
    ['Net Income / (Loss)', money(kpis.netIncome), kpis.netIncome >= 0 ? 'good' : 'bad'],
    ['Outstanding Homeowner Balances', money(kpis.totalOutstanding), kpis.totalOutstanding > 0 ? 'warn' : 'good'],
  ]
  ensureSpace(cardH + 4)
  let kx = MARGIN
  cards.forEach((c) => {
    kpiCard(kx, y, cardW, cardH, c[0], c[1], c[2])
    kx += cardW + 6
  })
  y += cardH + 12

  subheading('Narrative Summary')
  paragraph(
    `Total income of ${money(kpis.totalIncome)} was recorded against total expenses of ${money(kpis.totalExpenses)}, resulting in a net ` +
    `${kpis.netIncome >= 0 ? 'surplus' : 'deficit'} of ${money(Math.abs(kpis.netIncome))} for the period. Outstanding homeowner balances across ` +
    `the community total ${money(kpis.totalOutstanding)} as of report date. ${data.events.thisMonth.length} community event(s) were held during the period.`
  )
  y += 6

  // ---- 2. Financial Report ----
  sectionTitle('2', 'Financial Report')
  subheading('2.1 Income')

  const incomeRows = [
    ['Homeowner Assessments (Dues)', money(data.income.duesIncome)],
    ...data.income.serviceByName.map((s) => [`Amenity / Service — ${s.name}`, money(s.amount)]),
  ]
  incomeRows.push(['Total Income', money(data.income.totalIncome)])
  table(['Revenue Category', 'Amount'], incomeRows, {
    didParseCell: (d) => { if (d.row.index === incomeRows.length - 1) d.cell.styles.fontStyle = 'bold' },
  })

  subheading('2.2 Expenses')
  paragraph(`${data.expenses.entryCount} expense${data.expenses.entryCount === 1 ? '' : 's'} recorded this period.`, { size: 8.5, color: GRAY })
  y += 2

  if (data.expenses.byCategory.length) {
    const categoryRows = data.expenses.byCategory.map((c) => [c.category, String(c.count), money(c.amount)])
    categoryRows.push(['Total Expenses', String(data.expenses.entryCount), money(data.expenses.totalExpenses)])
    table(['Category', 'Entries', 'Amount'], categoryRows, {
      didParseCell: (d) => { if (d.row.index === categoryRows.length - 1) d.cell.styles.fontStyle = 'bold' },
    })
  } else {
    table(['Category', 'Entries', 'Amount'], [['No expenses recorded this period', '0', money(0)]])
  }

  if (data.expenses.entries.length) {
    subheading('Expense Detail')
    const itemRows = data.expenses.entries.map((e) => [
      dateShort.format(new Date(`${e.expense_date}T12:00:00+08:00`)),
      e.category,
      e.description || '—',
      e.reference_number || '—',
      e.recorded_by_name || '—',
      money(e.amount),
    ])
    table(['Date', 'Category', 'Description', 'Reference No.', 'Recorded By', 'Amount'], itemRows, {
      columnStyles: { 2: { cellWidth: 45 } },
    })
  } else {
    paragraph('No expenses recorded this period.', { size: 8.5, color: GRAY })
    y += 4
  }

  paragraph(`Total Expenses for ${monthLabel}: ${money(data.expenses.totalExpenses)}`, { bold: true, size: 10 })
  y += 6

  subheading('2.3 Accounts Receivable & Collections')
  table(['Metric', 'Value'], [
    ['Dues collected this period', money(data.receivables.duesIncome)],
    ['Amenity / service revenue collected this period', money(data.receivables.serviceIncome)],
    ['Outstanding homeowner balances (aggregate, as of report date)', money(data.receivables.totalOutstanding)],
    ['Number of accounts with an outstanding balance', String(data.receivables.outstandingAccountCount)],
  ])
  paragraph('Aggregate figures only — individual homeowner names and balances are withheld from this general report.', { size: 8, color: GRAY })
  y += 8

  // ---- 3. Community Activities ----
  sectionTitle('3', 'Community Activities')
  if (data.events.thisMonth.length) {
    table(['Date', 'Event', 'Location'], data.events.thisMonth.map((e) => [
      dateShort.format(new Date(`${e.event_date}T12:00:00+08:00`)), e.title, e.location || '—',
    ]))
  } else {
    paragraph('No community events were held during this period.', { size: 9, color: GRAY })
    y += 6
  }

  if (data.events.upcoming.length) {
    subheading('Upcoming Events')
    table(['Date', 'Event', 'Location'], data.events.upcoming.map((e) => [
      dateShort.format(new Date(`${e.event_date}T12:00:00+08:00`)), e.title, e.location || '—',
    ]))
  }

  // ---- 4. Documents ----
  sectionTitle('4', 'Documents & Supporting Information')
  if (data.documents.thisMonth.length) {
    table(['Document', 'Category', 'Date Added'], data.documents.thisMonth.map((d) => [
      d.title, d.category, dateShort.format(new Date(d.created_at)),
    ]))
  } else {
    paragraph('No documents were added to the library during this period.', { size: 9, color: GRAY })
    y += 6
  }

  // ---- 5. Items Not Yet Tracked ----
  subheading('5. Items Not Yet Tracked in the System')
  paragraph(
    'The following report areas require modules not yet built into PhilamLife, and are intentionally omitted above rather than shown with placeholder figures: ' +
    data.untrackedModules.join(', ') + '.',
    { size: 8.5, color: GRAY }
  )
  y += 8

  // ---- 6. Final Commentary ----
  sectionTitle('6', 'Final Management Commentary')
  paragraph(
    `The association recorded ${money(kpis.totalIncome)} in income against ${money(kpis.totalExpenses)} in expenses this period, a net ` +
    `${kpis.netIncome >= 0 ? 'surplus' : 'deficit'} of ${money(Math.abs(kpis.netIncome))}. Outstanding homeowner balances stand at ${money(kpis.totalOutstanding)}. ` +
    `Community activity on record for the period totals ${data.events.thisMonth.length} event(s).`
  )
  y += 4
  paragraph('This report is prepared for informational purposes only, based solely on records available in the PhilamLife system as of the date prepared. No figures have been estimated or fabricated.', { size: 8, color: GRAY })

  // ---- Signatures ----
  ensureSpace(30)
  y += 14
  const sigW = (PAGE_W - MARGIN * 2 - 20) / 2
  doc.setDrawColor(...NAVY)
  doc.line(MARGIN, y, MARGIN + sigW, y)
  doc.line(MARGIN + sigW + 20, y, MARGIN + sigW + 20 + sigW, y)
  y += 5
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`Prepared by${preparedBy ? ` — ${preparedBy}` : ''}`, MARGIN, y)
  doc.text('Reviewed / Approved by', MARGIN + sigW + 20, y)

  return doc
}