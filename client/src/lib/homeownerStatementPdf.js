import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const NAVY = [17, 42, 82]
const GRAY = [100, 116, 139]
const GRAY_LIGHT = [241, 245, 249]
const RED = [220, 38, 38]
const GREEN = [22, 163, 74]
const BORDER = [226, 232, 240]
const WHITE = [255, 255, 255]

const pesoNumber = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

// jsPDF's built-in Helvetica font has no glyph for the ₱ currency symbol —
// feeding it that character (as the browser's Intl currency formatter
// would produce) renders as garbled "±" artifacts. Stick to plain ASCII
// "PHP" text instead, matching the Monthly Report PDF.
const money = (value) => `PHP ${pesoNumber.format(Number(value || 0))}`

const PAGE_W = 215.9 // Letter portrait, mm
const PAGE_H = 279.4
const MARGIN = 16

/**
 * Builds and returns a jsPDF document for a single homeowner's ledger statement.
 */
export function buildHomeownerStatementPdf({
  hoaName,
  hoaAddress,
  homeownerName,
  blockLotLabel,
  totalCharges,
  paymentsAllocated,
  outstandingBalance,
  availableCredit,
  statementLines = [],
  preparedBy,
  datePrepared,
  timePrepared,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })

  // ---------- Header ----------
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, PAGE_W, 20, 'F')
  doc.setTextColor(...WHITE)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(hoaName || 'Homeowners Association', MARGIN, 9)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  if (hoaAddress) doc.text(hoaAddress, MARGIN, 15)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Homeowner Statement', PAGE_W - MARGIN, 9, { align: 'right' })
  doc.text(`Printed: ${datePrepared}${timePrepared ? `, ${timePrepared}` : ''}`, PAGE_W - MARGIN, 15, { align: 'right' })

  let y = 32

  // ---------- Homeowner identity ----------
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.text('HOMEOWNER STATEMENT', MARGIN, y)
  y += 7
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(homeownerName || 'Homeowner', MARGIN, y)
  y += 6
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.text(blockLotLabel || '', MARGIN, y)
  y += 10

  // ---------- Summary cards ----------
  const cards = [
    { label: 'Total charges', value: money(totalCharges), tone: NAVY },
    { label: 'Payments allocated', value: money(paymentsAllocated), tone: GREEN },
    { label: 'Outstanding balance', value: money(outstandingBalance), tone: Number(outstandingBalance) > 0 ? RED : GREEN },
    { label: 'Available credit', value: money(availableCredit), tone: GREEN },
  ]
  const cardW = (PAGE_W - MARGIN * 2 - 3 * 4) / 4
  const cardH = 20
  cards.forEach((card, index) => {
    const x = MARGIN + index * (cardW + 4)
    doc.setFillColor(...WHITE)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    const labelLines = doc.splitTextToSize(card.label.toUpperCase(), cardW - 6)
    doc.text(labelLines, x + 3.5, y + 7)
    doc.setTextColor(...card.tone)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.text(card.value, x + 3.5, y + cardH - 5)
  })
  y += cardH + 10

  // ---------- Statement lines table ----------
  const rows = statementLines.length
    ? statementLines.map((line) => [
        line.date,
        line.entry,
        line.reference,
        money(line.debit),
        money(line.credit),
        money(line.balance),
      ])
    : [['—', 'No statement entries found.', '—', '—', '—', '—']]

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Entry', 'Reference', 'Debit', 'Credit', 'Balance']],
    body: rows,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: PAGE_W - MARGIN * 2,
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.6, textColor: [30, 41, 59], lineColor: BORDER, lineWidth: 0.15, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: GRAY_LIGHT },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 56.9 },
      2: { cellWidth: 30 },
      3: { cellWidth: 27, halign: 'right' },
      4: { cellWidth: 27, halign: 'right' },
      5: { cellWidth: 27, halign: 'right' },
    },
  })

  y = doc.lastAutoTable.finalY + 20

  if (y > PAGE_H - 40) {
    doc.addPage('letter', 'portrait')
    y = 30
  }

  // ---------- Signatures ----------
  const sigLineW = (PAGE_W - MARGIN * 2 - 20) / 2
  doc.setDrawColor(...BORDER)
  doc.line(MARGIN, y, MARGIN + sigLineW, y)
  doc.line(PAGE_W - MARGIN - sigLineW, y, PAGE_W - MARGIN, y)
  y += 5
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`Prepared by${preparedBy ? ` — ${preparedBy}` : ''}`, MARGIN, y)
  doc.text('Reviewed / Approved by', PAGE_W - MARGIN - sigLineW, y)

  // ---------- Footer note ----------
  y += 14
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  const footerLines = doc.splitTextToSize(
    'This statement is prepared for informational purposes only, based solely on records available in the PhilamLife system as of the date printed.',
    PAGE_W - MARGIN * 2,
  )
  doc.text(footerLines, MARGIN, y)

  return doc
}