
import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { annualMoney, annualReportTotals } from '../lib/annualReportData'
import { manilaMonth } from '../hooks/useManilaMonthRollover'
import './ReportsPage.css'

const currentYear = () => Number(manilaMonth().slice(0, 4))

async function fetchAnnual(year) {
  const start = String(year) + '-01-01'
  const end = String(Number(year) + 1) + '-01-01'
  const [collections, expenses] = await Promise.all([
    fetchAll(() => supabase.from('monthly_collections')
      .select('month_start, dues_collected, service_collected')
      .gte('month_start', start).lt('month_start', end)
      .order('month_start'), { tiebreaker: null }),
    fetchAll(() => supabase.from('expenses')
      .select('id, expense_date, amount, status')
      .gte('expense_date', start).lt('expense_date', end)
      .order('expense_date')),
  ])
  if (collections.error || expenses.error) {
    throw new Error(collections.error?.message || expenses.error?.message)
  }
  if (!Array.isArray(collections.data) || !Array.isArray(expenses.data)) {
    throw new Error('Annual report sources returned an incomplete response.')
  }
  return annualReportTotals(year, collections.data, expenses.data, manilaMonth())
}

export default function AnnualReportsPage() {
  const [year, setYear] = useState(currentYear)
  const [report, setReport] = useState(null)
  const [loadedYear, setLoadedYear] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const request = useRef(0)
  const yearRef = useRef(year)
  yearRef.current = year

  useEffect(() => {
    const id = ++request.current
    setLoading(true)
    setError('')
    setReport(null)
    setLoadedYear(null)
    fetchAnnual(year).then((result) => {
      if (request.current !== id) return
      setReport(result)
      setLoadedYear(year)
    }).catch((failure) => {
      if (request.current === id) setError(failure?.message || 'Could not load annual report.')
    }).finally(() => {
      if (request.current === id) setLoading(false)
    })
    return () => { request.current += 1 }
  }, [year])

  async function downloadPdf() {
    if (loading || exporting || error || !report || loadedYear !== year) return
    const chosen = year
    setExporting(true)
    try {
      // Export from a fresh, verified database snapshot.
      const fresh = await fetchAnnual(chosen)
      if (yearRef.current !== chosen) return
      const { buildAnnualReportPdf } = await import('../lib/annualReportPdf')
      const document = buildAnnualReportPdf(fresh)
      document.save('HOA-Annual-Financial-Report-' + chosen + '.pdf')
    } catch (failure) {
      setError('Could not generate annual PDF: ' + (failure?.message || 'Unknown error.'))
    } finally {
      setExporting(false)
    }
  }

  const years = Array.from({ length: Math.max(1, currentYear() - 2026 + 1) },
    (_, index) => currentYear() - index)
  const verified = !loading && !error && report && loadedYear === year
  const show = (value, future) => future ? '—' : annualMoney(value)

  return (
    <div className="reports-page">
      <header className="reports-header no-print">
        <div className="reports-header-main">
          <div className="reports-header-text">
            <span className="reports-header-eyebrow">Finance Workspace</span>
            <h1>Annual Financial Report</h1>
            <p>Yearly management totals from saved receipts and dated expenses.</p>
            <Link to="/reports">Back to Monthly Reports</Link>
          </div>
        </div>
        <div className="reports-header-actions">
          <label>
            Reporting year{' '}
            <select aria-label="Reporting year" value={year}
              disabled={exporting} onChange={(event) => setYear(Number(event.target.value))}>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button type="button" className="reports-primary"
            disabled={!verified || exporting} onClick={downloadPdf}>
            {exporting ? 'Preparing PDF…' : 'Download Annual PDF'}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="reports-empty" role="status">Verifying annual financial records…</div>
      ) : !verified ? (
        <div className="reports-empty" role="alert">
          <strong>Annual report unavailable</strong>
          <p>{error || 'The report has not been verified. Reload the page to retry.'}</p>
        </div>
      ) : (
        <main className="monthly-report-doc">
          <div className="monthly-cover">
            <h1 className="monthly-cover-type">Annual Financial Management Report</h1>
            <p className="monthly-cover-period">{report.year}</p>
            <p>{report.yearToDate ? 'Year-to-date (not a closed financial year)' : 'Historical calendar-year activity'}</p>
          </div>
          <section className="monthly-section">
            <h2 className="monthly-section-title">Annual Financial Summary</h2>
            <div className="monthly-figure-band">
              <div className="monthly-figure"><span>Total income</span><strong>{annualMoney(report.income)}</strong></div>
              <div className="monthly-figure"><span>Expenses</span><strong>{annualMoney(report.expenses)}</strong></div>
              <div className="monthly-figure"><span>Net recorded activity</span><strong>{annualMoney(report.net)}</strong></div>
            </div>
            <p>Homeowner collections: {annualMoney(report.homeowner)}. Service collections: {annualMoney(report.service)}.</p>
          </section>
          <section className="monthly-section">
            <h2 className="monthly-section-title">Month-by-month comparison</h2>
            <div className="reports-table-wrap">
              <table>
                <thead><tr><th>Month</th><th>Homeowners</th><th>Services</th><th>Income</th><th>Expenses</th><th>Net activity</th></tr></thead>
                <tbody>
                  {report.months.map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td>{show(row.homeowner, row.future)}</td>
                      <td>{show(row.service, row.future)}</td>
                      <td>{show(row.income, row.future)}</td>
                      <td>{show(row.expenses, row.future)}</td>
                      <td>{show(row.net, row.future)}</td>
                    </tr>
                  ))}
                  <tr className="monthly-row-total">
                    <th>Annual totals</th>
                    <td>{annualMoney(report.homeowner)}</td>
                    <td>{annualMoney(report.service)}</td>
                    <td>{annualMoney(report.income)}</td>
                    <td>{annualMoney(report.expenses)}</td>
                    <td>{annualMoney(report.net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <section className="monthly-section">
            <h2 className="monthly-section-title">Basis and limitations</h2>
            <p>Figures are calculated from recorded homeowner and service collections, excluding voided receipts, and active expenses dated within the selected calendar year.</p>
            <p>Historical December 31 receivables, advance credits, opening cash, closing cash and bank reconciliation are not presented because certified year-end snapshots are unavailable.</p>
            <p>This is a management activity report, not an audited financial statement, formal period close or bank-reconciled cash flow.</p>
          </section>
        </main>
      )}
    </div>
  )
}
