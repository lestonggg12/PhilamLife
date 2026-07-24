import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './ReportsPage.css'

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
})

const monthLabel = new Intl.DateTimeFormat('en-PH', {
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Manila',
})

const dateLabel = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
})

const todayInManila = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

const currentMonthInManila = () => todayInManila().slice(0, 7)

function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
  }
}

function paymentKey(payment) {
  return `${String(payment.block_name || '').trim().toLowerCase()}|${String(payment.lot_number || '').trim().toLowerCase()}`
}

export default function ReportsPage({ user: suppliedUser }) {
  const [currentUser, setCurrentUser] = useState(suppliedUser || null)
  const [activeReport, setActiveReport] = useState('collections')
  const [selectedMonth, setSelectedMonth] = useState(currentMonthInManila())
  const [selectedYear, setSelectedYear] = useState(Number(currentMonthInManila().slice(0, 4)))
  const [payments, setPayments] = useState([])
  const [serviceTransactions, setServiceTransactions] = useState([])
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const role = currentUser?.role?.trim().toLowerCase()
  const canGenerateReports = role === 'admin' || role === 'treasurer'

  useEffect(() => {
    loadReports()
    resolveCurrentUser()
  }, [])

  async function resolveCurrentUser() {
    if (suppliedUser) {
      setCurrentUser(suppliedUser)
      return
    }

    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()
    if (authError || !authUser) return

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single()

    if (!profileError) setCurrentUser(profile)
  }

  async function loadReports() {
    setLoading(true)
    setError('')

    const [paymentResult, serviceResult, expenseResult] = await Promise.all([
      supabase
        .from('payments')
        .select('id, receipt_number, homeowner_name, block_name, lot_number, coverage_period, amount_paid, remaining_balance, payment_method, paid_at')
        .order('paid_at', { ascending: false }),
      supabase
        .from('service_transactions')
        .select('id, receipt_number, customer_name, block_name, lot_number, service_name, amount_paid, payment_method, paid_at')
        .order('paid_at', { ascending: false }),
      supabase
        .from('expenses')
        .select('id, expense_date, category, description, amount, reference_number, recorded_by_name, status, created_at')
        .order('expense_date', { ascending: false }),
    ])

    const loadError = paymentResult.error || serviceResult.error || expenseResult.error
    if (loadError) {
      setError(loadError.message)
    }
    if (!paymentResult.error) setPayments(paymentResult.data || [])
    if (!serviceResult.error) setServiceTransactions(serviceResult.data || [])
    if (!expenseResult.error) setExpenses(expenseResult.data || [])
    setLoading(false)
  }

  const validPayments = payments
  const activeExpenses = useMemo(
    () => expenses.filter((expense) => expense.status !== 'Voided'),
    [expenses]
  )

  const collectionRecords = useMemo(
    () => [
      ...validPayments.map((payment) => ({
        ...payment,
        recordKey: `payment-${payment.id}`,
        typeLabel: 'Dues',
        payerName: payment.homeowner_name,
        details: payment.coverage_period,
      })),
      ...serviceTransactions.map((transaction) => ({
        ...transaction,
        recordKey: `service-${transaction.id}`,
        typeLabel: 'Amenity / Service',
        payerName: transaction.customer_name,
        details: transaction.service_name,
      })),
    ].sort((a, b) => new Date(b.paid_at) - new Date(a.paid_at)),
    [validPayments, serviceTransactions]
  )

  const monthlyCollections = useMemo(() => {
    const { start, end } = monthBounds(selectedMonth)
    const startMs = new Date(start).getTime()
    const endMs = new Date(end).getTime()
    return collectionRecords.filter((record) => {
      const paidMs = new Date(record.paid_at).getTime()
      return paidMs >= startMs && paidMs < endMs
    })
  }, [collectionRecords, selectedMonth])

  const monthlyExpenses = useMemo(
    () => activeExpenses.filter((expense) => String(expense.expense_date).slice(0, 7) === selectedMonth),
    [activeExpenses, selectedMonth]
  )

  const unpaidAccounts = useMemo(() => {
    const latestByProperty = new Map()
    validPayments.forEach((payment) => {
      const key = paymentKey(payment)
      if (!latestByProperty.has(key)) latestByProperty.set(key, payment)
    })
    return [...latestByProperty.values()]
      .filter((payment) => Number(payment.remaining_balance) > 0)
      .sort((a, b) => Number(b.remaining_balance) - Number(a.remaining_balance))
  }, [validPayments])

  const annualRows = useMemo(() => {
    return Array.from({ length: 12 }, (_, index) => {
      const month = `${selectedYear}-${String(index + 1).padStart(2, '0')}`
      const { start, end } = monthBounds(month)
      const startMs = new Date(start).getTime()
      const endMs = new Date(end).getTime()
      const collection = collectionRecords
        .filter((record) => {
          const paidMs = new Date(record.paid_at).getTime()
          return paidMs >= startMs && paidMs < endMs
        })
        .reduce((sum, record) => sum + Number(record.amount_paid || 0), 0)
      const expense = activeExpenses
        .filter((item) => String(item.expense_date).slice(0, 7) === month)
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      return { month, collection, expense, net: collection - expense }
    })
  }, [collectionRecords, activeExpenses, selectedYear])

  const monthlyCollected = monthlyCollections.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0)
  const monthlySpent = monthlyExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const totalUnpaid = unpaidAccounts.reduce((sum, item) => sum + Number(item.remaining_balance || 0), 0)
  const annualCollected = annualRows.reduce((sum, item) => sum + item.collection, 0)
  const annualSpent = annualRows.reduce((sum, item) => sum + item.expense, 0)

  function generateReport() {
    if (!canGenerateReports) return
    window.print()
  }

  const selectedMonthName = monthLabel.format(new Date(`${selectedMonth}-15T12:00:00+08:00`))

  return (
    <div className="reports-page">
      <header className="reports-header no-print">
        <div>
          <h1>Financial Reports</h1>
          <p>Review collections, unpaid balances, annual totals, and expenses.</p>
        </div>
        {canGenerateReports && (
          <button type="button" className="reports-primary" onClick={generateReport} disabled={loading}>
            Generate Report
          </button>
        )}
      </header>

      <nav className="reports-tabs no-print" aria-label="Report type">
        <button className={activeReport === 'collections' ? 'active' : ''} onClick={() => setActiveReport('collections')}>Monthly Collections</button>
        <button className={activeReport === 'unpaid' ? 'active' : ''} onClick={() => setActiveReport('unpaid')}>Unpaid Accounts</button>
        <button className={activeReport === 'annual' ? 'active' : ''} onClick={() => setActiveReport('annual')}>Annual Summary</button>
        <button className={activeReport === 'expenses' ? 'active' : ''} onClick={() => setActiveReport('expenses')}>Expenses</button>
      </nav>

      <div className="reports-controls no-print">
        {activeReport === 'annual' ? (
          <label>Report year <input type="number" min="2000" max="2100" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))} /></label>
        ) : activeReport !== 'unpaid' ? (
          <label>Report month <input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} /></label>
        ) : <span>Shows the latest saved balance for every property.</span>}
      </div>

      {error && <p className="reports-error">Could not load reports: {error}</p>}

      <main className="report-sheet">
        <div className="report-print-heading">
          <h2>{activeReport === 'collections' ? 'Monthly Collections' : activeReport === 'unpaid' ? 'Unpaid Accounts' : activeReport === 'annual' ? 'Annual Financial Summary' : 'Expense Report'}</h2>
          <p>{activeReport === 'annual' ? selectedYear : activeReport === 'unpaid' ? `As of ${dateLabel.format(new Date())}` : selectedMonthName}</p>
        </div>

        {loading ? <p className="reports-empty">Loading financial records...</p> : (
          <>
            {activeReport === 'collections' && (
              <>
                <div className="report-summary"><span>Total collected <strong>{peso.format(monthlyCollected)}</strong></span><span>Receipts issued <strong>{monthlyCollections.length}</strong></span></div>
                <div className="reports-table-wrap"><table><thead><tr><th>Date</th><th>Receipt No.</th><th>Type</th><th>Homeowner / Customer</th><th>Block / Lot</th><th>Payment Details</th><th>Method</th><th className="number">Amount</th></tr></thead><tbody>
                  {monthlyCollections.length ? monthlyCollections.map((record) => <tr key={record.recordKey}><td>{dateLabel.format(new Date(record.paid_at))}</td><td>{record.receipt_number}</td><td>{record.typeLabel}</td><td>{record.payerName}</td><td>{record.block_name}, {record.lot_number}</td><td>{record.details}</td><td>{record.payment_method}</td><td className="number">{peso.format(record.amount_paid)}</td></tr>) : <tr><td colSpan="8" className="reports-empty">No collections for this month.</td></tr>}
                </tbody></table></div>
              </>
            )}

            {activeReport === 'unpaid' && (
              <>
                <div className="report-summary"><span>Total outstanding <strong>{peso.format(totalUnpaid)}</strong></span><span>Unpaid accounts <strong>{unpaidAccounts.length}</strong></span></div>
                <div className="reports-table-wrap"><table><thead><tr><th>Homeowner</th><th>Block / Lot</th><th>Last payment</th><th>Coverage</th><th className="number">Remaining Balance</th></tr></thead><tbody>
                  {unpaidAccounts.length ? unpaidAccounts.map((payment) => <tr key={payment.id}><td>{payment.homeowner_name}</td><td>{payment.block_name}, {payment.lot_number}</td><td>{dateLabel.format(new Date(payment.paid_at))}</td><td>{payment.coverage_period}</td><td className="number reports-due">{peso.format(payment.remaining_balance)}</td></tr>) : <tr><td colSpan="5" className="reports-empty">No unpaid accounts found.</td></tr>}
                </tbody></table></div>
              </>
            )}

            {activeReport === 'annual' && (
              <>
                <div className="report-summary"><span>Total collections <strong>{peso.format(annualCollected)}</strong></span><span>Total expenses <strong>{peso.format(annualSpent)}</strong></span><span>Net balance <strong>{peso.format(annualCollected - annualSpent)}</strong></span></div>
                <div className="reports-table-wrap"><table><thead><tr><th>Month</th><th className="number">Collections</th><th className="number">Expenses</th><th className="number">Net</th></tr></thead><tbody>
                  {annualRows.map((row) => <tr key={row.month}><td>{monthLabel.format(new Date(`${row.month}-15T12:00:00+08:00`))}</td><td className="number">{peso.format(row.collection)}</td><td className="number">{peso.format(row.expense)}</td><td className={`number ${row.net < 0 ? 'reports-due' : ''}`}>{peso.format(row.net)}</td></tr>)}
                </tbody></table></div>
              </>
            )}

            {activeReport === 'expenses' && (
              <>
                <div className="report-summary"><span>Total expenses <strong>{peso.format(monthlySpent)}</strong></span><span>Entries <strong>{monthlyExpenses.length}</strong></span></div>
                <div className="reports-table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Reference No.</th><th>Recorded by</th><th className="number">Amount</th></tr></thead><tbody>
                  {monthlyExpenses.length ? monthlyExpenses.map((expense) => <tr key={expense.id}><td>{dateLabel.format(new Date(`${expense.expense_date}T12:00:00+08:00`))}</td><td>{expense.category}</td><td>{expense.description}</td><td>{expense.reference_number || '—'}</td><td>{expense.recorded_by_name}</td><td className="number">{peso.format(expense.amount)}</td></tr>) : <tr><td colSpan="6" className="reports-empty">No expenses for this month.</td></tr>}
                </tbody></table></div>
              </>
            )}
          </>
        )}
        <footer className="report-footer">Generated on {dateLabel.format(new Date())}. Collection totals include dues and amenity/service receipts by payment date. Expense totals exclude voided records.</footer>
      </main>
    </div>
  )
}