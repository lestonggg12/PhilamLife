import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  collectionsRows,
  computeMonthlyReportData,
  formatDateOnly,
  formatMoney as money,
  formatReportDate,
  incomeTableRows,
  periodLabel,
  reportText,
} from './monthlyReportData'

// Palette: charcoal text, navy headings/rules, white only inside navy table
// headers. Red appears once, and only for a net deficit.
const INK = [31, 35, 40]
const NAVY = [20, 40, 75]
const MUTED = [98, 106, 116]
const RULE = [203, 208, 215]
const FILL = [243, 245, 248]
const WHITE = [255, 255, 255]
const ALERT = [153, 27, 27]

const PAGE_W = 215.9 // Letter portrait, mm
const PAGE_H = 279.4
const MARGIN = 20
const CONTENT_W = PAGE_W - MARGIN * 2
const TOP = 26 // first content line on pages after the cover
const BOTTOM = PAGE_H - 22 // lowest content line (footer sits below)

const FONT = 'helvetica'

/**
 * Builds the HOA Monthly Management Report as a jsPDF document.
 * Content flows continuously; a new page starts only when the next block
 * does not fit. Running headers/footers (with "Page X of Y") are drawn last,
 * once the page count is known.
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
  properties = [],
  charges = [],
  settings = null,
  documents = [],
  events = [],
  month,
}) {
  const data = computeMonthlyReportData({ payments, serviceTransactions, expenses, properties, charges, settings, documents, events, month })
  const text = reportText(data, { monthLabel, datePrepared })
  const { kpis } = data

  const orgFull = hoaName || 'Homeowners Association'
  const orgShort = orgFull.replace(/\s*homeowners association\s*$/i, '').trim() || orgFull
  const author = preparedBy || 'HOA Management'

  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  doc.setProperties({
    title: `${orgShort} Monthly Management Report - ${monthLabel}`,
    subject: 'Monthly Management Report',
    author,
    creator: orgFull,
  })

  let y = 0

  const setText = (color, size, style = 'normal') => {
    doc.setTextColor(...color)
    doc.setFont(FONT, style)
    doc.setFontSize(size)
  }

  function newPage() {
    doc.addPage('letter', 'portrait')
    y = TOP
  }

  function ensureSpace(needed) {
    if (y + needed > BOTTOM) newPage()
  }

  function sectionTitle(label) {
    if (y > TOP) y += 3
    ensureSpace(26)
    setText(NAVY, 14, 'bold')
    doc.text(label, MARGIN, y)
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN, y + 2.6, PAGE_W - MARGIN, y + 2.6)
    doc.setLineWidth(0.2)
    y += 11
  }

  function subheading(label, needed = 22) {
    ensureSpace(needed)
    setText(NAVY, 10.5, 'bold')
    doc.text(label, MARGIN, y)
    y += 6
  }

  function paragraph(content, { size = 9.5, color = INK, style = 'normal', gap = 0 } = {}) {
    setText(color, size, style)
    const lines = doc.splitTextToSize(content, CONTENT_W)
    const lineHeight = size * 0.5
    ensureSpace(lines.length * lineHeight + 2)
    setText(color, size, style)
    doc.text(lines, MARGIN, y)
    y += lines.length * lineHeight + gap
  }

  function table(head, body, { rightCols = [], totalRow = false, columnStyles = {}, fontSize = 8.5 } = {}) {
    ensureSpace(24)
    const styles = { ...columnStyles }
    rightCols.forEach((c) => { styles[c] = { ...(styles[c] || {}), halign: 'right' } })
    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      theme: 'plain',
      margin: { top: TOP, left: MARGIN, right: MARGIN, bottom: PAGE_H - BOTTOM },
      rowPageBreak: 'avoid',
      styles: {
        font: FONT,
        fontSize,
        cellPadding: { top: 2.6, bottom: 2.6, left: 3, right: 3 },
        textColor: INK,
        lineColor: RULE,
        lineWidth: { top: 0, right: 0, bottom: 0.2, left: 0 },
        valign: 'middle',
      },
      headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: fontSize - 0.5, lineWidth: 0 },
      columnStyles: styles,
      didParseCell: (d) => {
        if (d.section === 'head' && rightCols.includes(d.column.index)) d.cell.styles.halign = 'right'
        if (totalRow && d.section === 'body' && d.row.index === body.length - 1) {
          d.cell.styles.fontStyle = 'bold'
          d.cell.styles.fillColor = FILL
          d.cell.styles.textColor = NAVY
          d.cell.styles.lineColor = NAVY
          d.cell.styles.lineWidth = { top: 0.4, right: 0, bottom: 0.4, left: 0 }
        }
      },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // ======================= COVER =======================
  setText(NAVY, 30, 'bold')
  doc.text(orgShort, MARGIN, 68)
  setText(MUTED, 14)
  doc.text('Homeowners Association', MARGIN, 77)

  doc.setDrawColor(...NAVY)
  doc.setLineWidth(1)
  doc.line(MARGIN, 90, PAGE_W - MARGIN, 90)
  doc.setLineWidth(0.2)

  setText(NAVY, 9, 'bold')
  doc.text('MONTHLY MANAGEMENT REPORT', MARGIN, 102, { charSpace: 0.6 })
  setText(INK, 32, 'bold')
  doc.text(monthLabel, MARGIN, 117)
  if (hoaAddress) {
    setText(MUTED, 11)
    doc.text(hoaAddress, MARGIN, 126)
  }

  // Document details
  doc.setDrawColor(...RULE)
  doc.line(MARGIN, 196, PAGE_W - MARGIN, 196)
  const colW = CONTENT_W / 3
  const details = [
    ['Reporting period', periodLabel(month)],
    ['Prepared by', author],
    ['Date prepared', datePrepared],
  ]
  details.forEach(([label, value], i) => {
    const x = MARGIN + colW * i
    setText(NAVY, 8.5, 'bold')
    doc.text(label, x, 205)
    setText(INK, 10)
    doc.text(doc.splitTextToSize(value, colW - 6), x, 211)
  })
  doc.line(MARGIN, 224, PAGE_W - MARGIN, 224)
  setText(MUTED, 8.5)
  doc.text('Prepared for distribution to homeowners, board members, and property management.', MARGIN, 232)

  // ======================= 1. EXECUTIVE SUMMARY =======================
  newPage()
  sectionTitle('1. Executive Summary')

  const netLabel = kpis.netIncome >= 0 ? 'Net surplus' : 'Net deficit'
  const figures = [
    ['Total revenue', money(kpis.totalIncome), INK],
    ['Total expenditures', money(kpis.totalExpenses), INK],
    [netLabel, money(Math.abs(kpis.netIncome)), kpis.netIncome < 0 ? ALERT : NAVY],
    ['Outstanding balances', money(kpis.totalOutstanding), INK],
  ]
  const bandH = 24
  const cellW = CONTENT_W / figures.length
  doc.setFillColor(...FILL)
  doc.rect(MARGIN, y, CONTENT_W, bandH, 'F')
  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  doc.setLineWidth(0.2)
  doc.setDrawColor(...RULE)
  doc.line(MARGIN, y + bandH, PAGE_W - MARGIN, y + bandH)
  figures.forEach(([label, value, color], i) => {
    const x = MARGIN + cellW * i
    if (i > 0) doc.line(x, y + 4, x, y + bandH - 4)
    setText(MUTED, 7, 'bold')
    doc.text(label.toUpperCase(), x + 4, y + 8.5, { charSpace: 0.2 })
    setText(color, 12.5, 'bold')
    doc.text(value, x + 4, y + 17.5)
  })
  y += bandH + 10

  subheading('Management overview')
  paragraph(text.overview, { gap: 10 })

  // ======================= 2. FINANCIAL REPORT =======================
  sectionTitle('2. Financial Report')

  subheading('2.1 Income')
  table(['Revenue category', 'Amount'], incomeTableRows(data.income, money), {
    rightCols: [1],
    totalRow: true,
    columnStyles: { 1: { cellWidth: 45 } },
  })

  subheading('2.2 Expenses', 52)
  paragraph(text.expenseIntro, { size: 8.5, color: MUTED, gap: 3 })
  if (data.expenses.byCategory.length) {
    const categoryRows = data.expenses.byCategory.map((c) => [c.category, String(c.count), money(c.amount)])
    categoryRows.push(['Total expenses', String(data.expenses.entryCount), money(data.expenses.totalExpenses)])
    table(['Category', 'Entries', 'Amount'], categoryRows, {
      rightCols: [1, 2],
      totalRow: true,
      columnStyles: { 1: { cellWidth: 25 }, 2: { cellWidth: 45 } },
    })
  } else {
    y += 3
  }

  if (data.expenses.entries.length) {
    subheading('Expense detail', 40)
    const itemRows = data.expenses.entries.map((e) => [
      formatDateOnly(e.expense_date),
      e.category,
      e.description || '\u2014',
      e.reference_number || '\u2014',
      e.recorded_by_name || '\u2014',
      money(e.amount),
    ])
    table(['Date', 'Category', 'Description', 'Ref. no.', 'Recorded by', 'Amount'], itemRows, {
      rightCols: [5],
      fontSize: 8,
      columnStyles: {
        0: { cellWidth: 23 },
        1: { cellWidth: 29 },
        3: { cellWidth: 22 },
        4: { cellWidth: 26 },
        5: { cellWidth: 30 },
      },
    })
  }

  subheading('2.3 Accounts Receivable and Collections')
  table(['Measure', 'Value'], collectionsRows(data.receivables), {
    rightCols: [1],
    columnStyles: { 1: { cellWidth: 45 } },
  })
  paragraph('Aggregate figures only. Individual homeowner names and balances are withheld from this report.', {
    size: 8, color: MUTED, gap: 10,
  })

  // ======================= 3. COMMUNITY ACTIVITIES =======================
  sectionTitle('3. Community Activities')
  const eventRows = (list) => list.map((e) => [formatDateOnly(e.event_date), e.title, e.location || '\u2014'])
  const eventCols = { 0: { cellWidth: 30 }, 2: { cellWidth: 55 } }
  if (data.events.thisMonth.length) {
    table(['Date', 'Event', 'Location'], eventRows(data.events.thisMonth), { columnStyles: eventCols })
  } else {
    paragraph('No community events were recorded for this period.', { size: 9, color: MUTED, gap: 6 })
  }
  if (data.events.upcoming.length) {
    subheading('Upcoming events', 40)
    table(['Date', 'Event', 'Location'], eventRows(data.events.upcoming), { columnStyles: eventCols })
  }

  // ======================= 4. DOCUMENTS =======================
  sectionTitle('4. Documents and Supporting Information')
  if (data.documents.thisMonth.length) {
    table(['Document', 'Category', 'Date added'], data.documents.thisMonth.map((d) => [
      d.title, d.category, formatReportDate(d.created_at),
    ]), { columnStyles: { 1: { cellWidth: 40 }, 2: { cellWidth: 32 } } })
  } else {
    paragraph('No documents were added to the library during this period.', { size: 9, color: MUTED, gap: 6 })
  }

  // ======================= 5. SCOPE =======================
  sectionTitle('5. Scope of This Report')
  paragraph(text.scope, { gap: 10 })

  // ======================= 6. COMMENTARY + SIGNATURES (kept together) =======================
  setText(INK, 9.5)
  const commentaryLines = doc.splitTextToSize(text.commentary, CONTENT_W).length
  setText(MUTED, 8)
  const basisLines = doc.splitTextToSize(text.basis, CONTENT_W).length
  const closingHeight = 11 + commentaryLines * 4.75 + 8 + 5 + basisLines * 4 + 30 + 22
  ensureSpace(closingHeight)

  sectionTitle('6. Management Commentary')
  paragraph(text.commentary, { gap: 6 })
  subheading('Basis of preparation')
  paragraph(text.basis, { size: 8.5, color: MUTED, gap: 4 })

  y += 24
  const sigGap = 20
  const sigW = (CONTENT_W - sigGap) / 2
  const sigs = [
    { x: MARGIN, label: 'Prepared by', name: author },
    { x: MARGIN + sigW + sigGap, label: 'Reviewed and approved by', name: 'Name and position' },
  ]
  doc.setDrawColor(...INK)
  sigs.forEach((s) => {
    doc.line(s.x, y, s.x + sigW, y)
    setText(NAVY, 8.5, 'bold')
    doc.text(s.label, s.x, y + 5)
    setText(s.label === 'Prepared by' ? INK : MUTED, 8.5)
    doc.text(s.name, s.x, y + 10)
    setText(MUTED, 8.5)
    doc.text('Date:', s.x, y + 18)
    doc.setDrawColor(...RULE)
    doc.line(s.x + 10, y + 18.5, s.x + 55, y + 18.5)
    doc.setDrawColor(...INK)
  })

  // ======================= RUNNING HEADERS / FOOTERS =======================
  const total = doc.getNumberOfPages()
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page)
    if (page > 1) {
      setText(NAVY, 8.5, 'bold')
      doc.text(orgFull, MARGIN, 14)
      setText(MUTED, 8)
      doc.text(`Monthly Management Report  |  ${monthLabel}`, PAGE_W - MARGIN, 14, { align: 'right' })
      doc.setDrawColor(...RULE)
      doc.line(MARGIN, 17.5, PAGE_W - MARGIN, 17.5)
    }
    doc.setDrawColor(...RULE)
    doc.line(MARGIN, PAGE_H - 14, PAGE_W - MARGIN, PAGE_H - 14)
    setText(MUTED, 7.5)
    doc.text(`${orgShort}  |  Prepared for informational purposes`, MARGIN, PAGE_H - 9)
    doc.text(`Page ${page} of ${total}`, PAGE_W - MARGIN, PAGE_H - 9, { align: 'right' })
  }

  return doc
}