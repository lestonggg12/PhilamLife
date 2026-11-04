// The Annual PDF delegates to the identical, tested Monthly Report renderer.
import { buildMonthlyReportPdf } from './monthlyReportPdf'

export function buildAnnualReportPdf({ report, hoaName, hoaAddress, preparedBy, datePrepared }) {
  if (!report || !Array.isArray(report.monthlySummary) || report.monthlySummary.length !== 12 || !report.narrative) {
    throw new Error('Complete, verified annual report data is required before export.')
  }
  return buildMonthlyReportPdf({
    month: report.year + '-01',
    monthLabel: report.year,
    hoaName, hoaAddress, preparedBy, datePrepared,
    precomputedReport: report,
    reportNarrative: report.narrative,
    annualMonths: report.monthlySummary,
  })
}
