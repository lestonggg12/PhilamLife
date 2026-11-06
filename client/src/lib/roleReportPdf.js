import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { monthTitle, periodLabel } from './monthlyReportData'

const INK = [31,35,40]
const NAVY = [20,40,75]
const MUTED = [98,106,116]
const RULE = [203,208,215]
const FILL = [243,245,248]
const PAGE_W = 215.9
const PAGE_H = 279.4
const M = 20

// Shared official print language: Letter portrait, navy cover, charcoal body,
// navy-headed tables, running page numbers, and signature blocks.
export function buildRoleReportPdf({ report, month, hoaName, address, preparedBy, datePrepared }) {
  if (!report || !Array.isArray(report.sections) || !Array.isArray(report.metrics)) {
    throw Error('A complete verified role report is required to export.')
  }
  const doc = new jsPDF({ format: 'letter', unit: 'mm' })
  const orgFull = hoaName || 'Homeowners Association'
  const orgShort = orgFull.replace(/\s*homeowners association\s*$/i, '').trim() || orgFull
  const plain = value => String(value ?? '').replace(/[—–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/₱/g, 'PHP ')
  const text = (s, x, y, size = 10, bold = false, color = INK) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    doc.text(plain(s), x, y)
  }
  const paragraph = (s, x, y, width = PAGE_W - 2 * M, size = 9.5) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(plain(s), width)
    doc.text(lines, x, y)
    return y + lines.length * 5.2 + 5
  }
  const ensure = (y, h) => y + h > PAGE_H - 22 ? (doc.addPage(), 28) : y
  doc.setProperties({ title: `${orgShort} - ${report.title} - ${monthTitle(month)}`, author: preparedBy, creator: orgFull })
  text(orgShort, M, 68, 30, true, NAVY)
  text('Homeowners Association', M, 77, 14, false, MUTED)
  doc.setDrawColor(...NAVY); doc.setLineWidth(1); doc.line(M, 90, PAGE_W - M, 90)
  text(report.title.toUpperCase(), M, 102, 9, true, NAVY)
  text(monthTitle(month), M, 117, 28, true)
  if (address) text(doc.splitTextToSize(plain(address), PAGE_W - 2*M)[0], M, 128, 10, false, MUTED)
  doc.setDrawColor(...RULE); doc.setLineWidth(0.2); doc.line(M, 196, PAGE_W - M, 196)
  const details = [ ['Reporting period',periodLabel(month)], ['Prepared by',preparedBy], ['Date prepared',datePrepared] ]
  details.forEach(([label,value],i) => {
    const x = M + i * (PAGE_W - 2*M)/3
    text(label,x,205,8.5,true,NAVY)
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...INK)
    doc.text(doc.splitTextToSize(plain(value),(PAGE_W-2*M)/3-6),x,212)
  })
  doc.line(M,224,PAGE_W-M,224)
  text('Prepared for association management review and authorized distribution.',M,232,8.5,false,MUTED)
  doc.addPage(); let y = 30
  const heading = (title) => {
    y = ensure(y, 24)
    text(title,M,y,14,true,NAVY)
    doc.setDrawColor(...NAVY); doc.line(M,y+3,PAGE_W-M,y+3)
    y += 13
  }
  heading('Overview')
  const colW = (PAGE_W-2*M)/report.metrics.length
  doc.setFillColor(...FILL); doc.rect(M,y-3,PAGE_W-2*M,23,'F')
  report.metrics.forEach(([label,value],i) => {
    const x=M+i*colW+3
    text(doc.splitTextToSize(plain(label.toUpperCase()),colW-6)[0],x,y+3,7,true,MUTED)
    text(doc.splitTextToSize(plain(value),colW-6)[0],x,y+11,11,true,NAVY)
  })
  y += 32
  y = paragraph(report.context,M,y)
  for (const s of report.sections) {
    heading(s.title)
    y = paragraph(s.intro,M,y)
    for (const t of s.tables) {
      y = ensure(y, 26)
      text(t.title,M,y,10.5,true,NAVY); y += 5
      autoTable(doc, {
        startY: y,
        head: [t.head.map(plain)],
        body: t.rows.length ? t.rows.map(row => row.map(plain)) : [[ 'No records for the reporting period.', ...t.head.slice(1).map(() => '') ]],
        theme: 'plain',
        margin: { left:M, right:M, top:28, bottom:24 },
        rowPageBreak:'avoid',
        styles: {font:'helvetica',fontSize:8.5,textColor:INK,
          cellPadding:{top:2.6,bottom:2.6,left:3,right:3},
          lineColor:RULE,lineWidth:{top:0,right:0,bottom:0.2,left:0}},
        headStyles:{fillColor:NAVY,textColor:[255,255,255],fontStyle:'bold'},
      })
      y = doc.lastAutoTable.finalY + 11
    }
    if (s.note) {
      y = ensure(y, 22)
      text('Verification note', M, y, 9, true, NAVY)
      y += 6
      y = paragraph(s.note, M, y, PAGE_W - 2 * M, 8.7)
    }
  }
  y = ensure(y, 26)
  heading('Basis of Preparation')
  y = paragraph(report.basis || 'Verified source records only.', M, y, PAGE_W - 2 * M, 9)
  y = ensure(y,50)
  text('Prepared by',M,y+15,9,true,NAVY)
  text('Reviewed and approved by',M+90,y+15,9,true,NAVY)
  doc.setDrawColor(...INK); doc.line(M,y+7,M+70,y+7); doc.line(M+90,y+7,PAGE_W-M,y+7)
  text(preparedBy,M,y+22,9)
  text('Name and position',M+90,y+22,9,false,MUTED)
  text('Date:',M,y+32,9,false,MUTED)
  text('Date:',M+90,y+32,9,false,MUTED)
  const pages=doc.getNumberOfPages()
  for (let i=2;i<=pages;i++) {
    doc.setPage(i)
    doc.setDrawColor(...RULE); doc.line(M,PAGE_H-16,PAGE_W-M,PAGE_H-16)
    text(`${orgShort} | ${report.title}`,M,PAGE_H-11,7.5,false,MUTED)
    text(`Page ${i} of ${pages}`,PAGE_W-M-22,PAGE_H-11,7.5,false,MUTED)
  }
  return doc
}
