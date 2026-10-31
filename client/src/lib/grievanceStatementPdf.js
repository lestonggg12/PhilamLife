import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { statementRows } from './grievances'

export function downloadGrievanceStatement(report, organization, preparedBy = 'Treasurer') {
  const doc = new jsPDF()
  const heading = organization.hoaName || organization.hoa_name || 'Homeowners Association'
  doc.setFontSize(15)
  doc.text(doc.splitTextToSize(heading, 180), 15, 16)
  doc.setFontSize(12)
  doc.text('Grievances Statement', 15, 34)
  doc.setFontSize(10)
  doc.text(`Period: ${report.from} to ${report.to} (Philippine time)`, 15, 42)
  let y = 48
  const section = (title, head, body) => {
    autoTable(doc, { startY: y, head: [[title, head]], body: body.length ? body : [['No open cases', 0]], margin: { left: 15, right: 15 }, styles: { fontSize: 9, cellPadding: 2 }, headStyles: { fillColor: [22, 99, 158] }, columnStyles: { 1: { halign: 'right', cellWidth: 35 } }, didParseCell: (cell) => { if (cell.column.index === 1) cell.cell.styles.halign = 'right'; if (title === 'Case movement' && cell.section === 'body' && [3,7].includes(cell.row.index)) { cell.cell.styles.fontStyle = 'bold'; cell.cell.styles.fillColor = [237,245,251] } } })
    y = doc.lastAutoTable.finalY + 7
  }
  section('Case movement', 'Cases', statementRows(report))
  section('Open at end by status', 'Cases', report.statuses.map((row) => [row.label, row.count]))
  section('Open at end by category', 'Cases', report.categories.map((row) => [row.label, row.count]))
  section('Open at end by block', 'Cases', report.blocks.map((row) => [row.label, row.count]))
  section('Age of open cases at period end', 'Cases', report.aging.map((row) => [row.label, row.count]))
  if (y > 240) { doc.addPage(); y = 20 }
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize('Referred cases remain open until closed. Each reopening and closure is counted, including repeated movements of the same case. Average filing-to-closure days: '+(report.average_days_to_close ?? 'No closures')+'. This report contains case counts only; no fines or payments are posted.', 180), 15, y)
  doc.text(`Prepared by: ${preparedBy}`, 15, y + 25)
  doc.text(`Prepared: ${new Date(report.generated_at).toLocaleString('en-PH', {timeZone:'Asia/Manila'})}`, 15, y + 31)
  doc.save(`Grievances-${report.from}-to-${report.to}.pdf`)
}
