import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const NAVY = [17, 42, 82]
const GRAY = [83, 103, 123]
const LIGHT = [244, 247, 250]
const BORDER = [220, 228, 237]
const WHITE = [255, 255, 255]
const GREEN = [26, 111, 78]
const RED = [170, 47, 39]
const PAGE_W = 215.9
const PAGE_H = 279.4
const MARGIN = 16
const WIDTH = PAGE_W - MARGIN * 2
// Helvetica has no peso glyph. Normalize descriptions too, not saved records.
const text = (value) => String(value ?? '').replace(/₱/g, 'PHP ').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
const money = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const balance = (value) => Number(value) < 0 ? `${money(-Number(value))} credit` : money(value)

export function buildHomeownerStatementPdf({
  hoaName, hoaAddress, homeownerName, blockLotLabel,
  totalCharges = 0, openingBalance = 0, paymentsAllocated = 0,
  paymentsLabel = 'Payments received', annualDiscountCredit = 0,
  otherAdjustments = 0, outstandingBalance = 0, availableCredit = 0,
  totalDebits = 0, totalCredits = 0, closingBalance = 0,
  reconciliationNote = '', statementLines = [], preparedBy, datePrepared, timePrepared,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const headerPages = new Set()
  function header() {
    const page = doc.internal.getCurrentPageInfo().pageNumber
    if (headerPages.has(page)) return
    headerPages.add(page)
    doc.setFillColor(...NAVY)
    doc.rect(0, 0, PAGE_W, 21, 'F')
    doc.setTextColor(...WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(text(hoaName || 'Homeowners Association'), MARGIN, 9, { maxWidth: 110 })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    if (hoaAddress) doc.text(text(hoaAddress), MARGIN, 16, { maxWidth: 110 })
    doc.text('Homeowner Statement', PAGE_W - MARGIN, 9, { align: 'right' })
    doc.text(text(`Printed: ${datePrepared || ''}${timePrepared ? `, ${timePrepared}` : ''}`), PAGE_W - MARGIN, 16, { align: 'right' })
  }
  header()
  let y = 33
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('HOMEOWNER STATEMENT', MARGIN, y)
  y += 8
  doc.setTextColor(...NAVY)
  doc.setFontSize(16)
  const nameLines = doc.splitTextToSize(text(homeownerName || 'Homeowner'), WIDTH)
  doc.text(nameLines, MARGIN, y)
  y += nameLines.length * 6 + 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(text(blockLotLabel), MARGIN, y)
  y += 7
  doc.setTextColor(...GRAY)
  doc.setFontSize(8)
  const contextLines = doc.splitTextToSize('All available history for this lot. Amounts in Philippine pesos; dates and times in Asia/Manila. A balance marked "credit" is available against future charges.', WIDTH)
  doc.text(contextLines, MARGIN, y)
  y += contextLines.length * 4 + 7

  const cards = [
    ['Opening balance brought forward', balance(openingBalance), NAVY],
    ['Charges added', money(totalCharges), NAVY],
    [paymentsLabel + ' (money collected)', money(paymentsAllocated), GREEN],
    ['Annual discount credit (non-cash)', money(annualDiscountCredit), GREEN],
    ['Outstanding balance', money(outstandingBalance), Number(outstandingBalance) > 0 ? RED : NAVY],
    ['Available credit', money(availableCredit), GREEN],
  ]
  if (otherAdjustments) cards.push(['Other balance adjustments', balance(otherAdjustments), NAVY])
  const cardWidth = (WIDTH - 8) / 3
  const cardHeight = 22
  cards.forEach(([label, value, tone], index) => {
    const x = MARGIN + (index % 3) * (cardWidth + 4)
    const top = y + Math.floor(index / 3) * (cardHeight + 4)
    doc.setFillColor(...LIGHT)
    doc.setDrawColor(...BORDER)
    doc.roundedRect(x, top, cardWidth, cardHeight, 2, 2, 'FD')
    doc.setTextColor(...GRAY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(doc.splitTextToSize(text(label), cardWidth - 7), x + 3.5, top + 6)
    doc.setTextColor(...tone)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(text(value), x + 3.5, top + 17)
  })
  y += Math.ceil(cards.length / 3) * (cardHeight + 4) + 4
  if (reconciliationNote) {
    autoTable(doc, {
      startY: y,
      body: text(reconciliationNote).split('\n').filter(Boolean).map((note) => [note]),
      margin: { left: MARGIN, right: MARGIN, top: 28, bottom: 20 },
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, textColor: GRAY, overflow: 'linebreak' },
      didDrawPage: header,
    })
    y = doc.lastAutoTable.finalY + 7
  }
  const rows = statementLines.length ? statementLines.map((line) => [
    text(line.date || '-'), text(line.entry), text(line.reference || '-'),
    money(line.debit), money(line.credit), balance(line.balance),
  ]) : [['-', 'No statement entries found.', '-', money(0), money(0), balance(closingBalance)]]
  autoTable(doc, {
    startY: y,
    head: [['Date / time', 'Entry and details', 'Receipt / reference', 'Charge / debit', 'Payment / credit', 'Running balance']],
    body: rows,
    foot: [[{ content: 'Statement totals / closing balance', colSpan: 3 }, money(totalDebits), money(totalCredits), balance(closingBalance)]],
    showFoot: 'lastPage',
    margin: { left: MARGIN, right: MARGIN, top: 28, bottom: 20 },
    tableWidth: WIDTH,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.4, textColor: NAVY, lineColor: BORDER, lineWidth: 0.15, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: NAVY, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
    footStyles: { fillColor: LIGHT, textColor: NAVY, fontStyle: 'bold', halign: 'right' },
    alternateRowStyles: { fillColor: LIGHT },
    columnStyles: {
      0: { cellWidth: 22 }, 1: { cellWidth: 52.9 }, 2: { cellWidth: 28 },
      3: { cellWidth: 27, halign: 'right' }, 4: { cellWidth: 27, halign: 'right' },
      5: { cellWidth: 27, halign: 'right' },
    },
    didDrawPage: header,
  })
  y = doc.lastAutoTable.finalY + 17
  if (y > PAGE_H - 38) {
    doc.addPage()
    header()
    y = 38
  }
  const signatureWidth = (WIDTH - 20) / 2
  doc.setDrawColor(...BORDER)
  doc.line(MARGIN, y, MARGIN + signatureWidth, y)
  doc.line(PAGE_W - MARGIN - signatureWidth, y, PAGE_W - MARGIN, y)
  doc.setTextColor(...GRAY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  const preparedLines = doc.splitTextToSize(text(`Prepared by${preparedBy ? ` - ${preparedBy}` : ''}`), signatureWidth)
  doc.text(preparedLines, MARGIN, y + 5)
  doc.text('Reviewed / Approved by', PAGE_W - MARGIN - signatureWidth, y + 5)
  y += Math.max(preparedLines.length * 4, 4) + 12
  doc.setFontSize(7)
  doc.text(doc.splitTextToSize('Based on records available in the PhilamLife system as of the printed date. Voided entries are retained for history and excluded from statement totals.', WIDTH), MARGIN, y)
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(`Page ${page} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' })
  }
  return doc
}
