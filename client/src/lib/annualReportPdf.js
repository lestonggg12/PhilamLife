
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { annualMoney } from './annualReportData'

export function buildAnnualReportPdf(report) {
  if (!report || !Array.isArray(report.months) || report.months.length !== 12) {
    throw new Error('An incomplete annual report cannot be exported.')
  }
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  doc.setProperties({ title: 'Annual Financial Management Report - ' + report.year })
  doc.setFontSize(17)
  doc.text('Annual Financial Management Report', 15, 19)
  doc.setFontSize(11)
  doc.text('Calendar year: ' + report.year, 15, 28)
  doc.text(report.yearToDate ? 'Year-to-date; accounting period not closed' : 'Historical calendar-year activity', 15, 35)

  autoTable(doc, {
    startY: 43,
    head: [['Month', 'Homeowners', 'Services', 'Income', 'Expenses', 'Net']],
    body: [
      ...report.months.map((row) => [
        row.month,
        row.future ? '-' : annualMoney(row.homeowner),
        row.future ? '-' : annualMoney(row.service),
        row.future ? '-' : annualMoney(row.income),
        row.future ? '-' : annualMoney(row.expenses),
        row.future ? '-' : annualMoney(row.net),
      ]),
      ['TOTAL', annualMoney(report.homeowner), annualMoney(report.service),
        annualMoney(report.income), annualMoney(report.expenses), annualMoney(report.net)],
    ],
    styles: { fontSize: 7 },
    headStyles: { fillColor: [34, 54, 80] },
    margin: { left: 12, right: 12 },
    theme: 'grid',
  })

  const y = doc.lastAutoTable.finalY + 12
  const notes = [
    'Income reflects recorded cash collections. Voided receipts and expenses are excluded.',
    'Historical year-end receivables, advance credits and cash balances are unavailable.',
    'This management report has not been independently audited or bank-reconciled.',
    'No accounting period is automatically closed by generating this document.',
  ]
  doc.setFontSize(9)
  const lines = doc.splitTextToSize(notes.join(' '), 180)
  if (y + lines.length * 5 > 265) doc.addPage()
  doc.text(lines, 15, y + lines.length * 5 > 265 ? 20 : y)
  return doc
}
