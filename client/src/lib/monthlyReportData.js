// Pure data computation for the HOA Monthly Report.
// No rendering here — both ReportsPage (on-screen) and monthlyReportPdf.js
// (PDF export) consume this so the two always show identical figures.
//
// Trimmed to real, calculable figures only. Anything the current schema
// can't support (maintenance, violations, security, capital projects,
// board action items, reserve fund, budget vs. actual, collection rate)
// is disclosed once in `untrackedModules`, not repeated as N/A everywhere.

export function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
    startMs: new Date(`${month}-01T00:00:00+08:00`).getTime(),
    endMs: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`).getTime(),
  }
}

export const untrackedModules = [
  'Maintenance & facility requests',
  'Violations & compliance',
  'Security & incident reports',
  'Capital projects',
  'Reserve fund activity',
  'Board action items',
  'Budget vs. actual (no budget module configured)',
]

/**
 * @param {object} raw
 * @param {Array} raw.payments        - already excludes voided
 * @param {Array} raw.serviceTransactions
 * @param {Array} raw.expenses        - already excludes voided
 * @param {Array} raw.ledgerAccounts  - from fetchLedgerAccounts()
 * @param {Array} raw.documents
 * @param {Array} raw.events
 * @param {string} raw.month          - 'YYYY-MM'
 */
export function computeMonthlyReportData(raw) {
  const { payments = [], serviceTransactions = [], expenses = [], ledgerAccounts = [], documents = [], events = [], month } = raw
  const range = monthBounds(month)

  const inRange = (iso) => {
    if (!iso) return false
    const ms = new Date(iso).getTime()
    return ms >= range.startMs && ms < range.endMs
  }

  const monthlyDues = payments.filter((p) => inRange(p.paid_at))
  const monthlyServices = serviceTransactions.filter((t) => inRange(t.paid_at))
  const monthlyExpenses = expenses
    .filter((e) => inRange(`${e.expense_date}T12:00:00+08:00`))
    .sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date))

  const duesIncome = monthlyDues.reduce((s, p) => s + Number(p.amount_paid || 0), 0)
  const serviceIncome = monthlyServices.reduce((s, t) => s + Number(t.amount_paid || 0), 0)
  const totalIncome = duesIncome + serviceIncome
  const totalExpenses = monthlyExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const netIncome = totalIncome - totalExpenses

  const outstandingAccounts = ledgerAccounts.filter((a) => Number(a.balance) > 0)
  const totalOutstanding = outstandingAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)

  const expenseByCategory = new Map()
  monthlyExpenses.forEach((e) => {
    const cat = e.category || 'Uncategorized'
    const current = expenseByCategory.get(cat) || { category: cat, count: 0, amount: 0 }
    current.count += 1
    current.amount += Number(e.amount || 0)
    expenseByCategory.set(cat, current)
  })
  const expenseCategories = Array.from(expenseByCategory.values()).sort((a, b) => b.amount - a.amount)

  const serviceByName = new Map()
  monthlyServices.forEach((t) => {
    const name = t.service_name || 'Other'
    serviceByName.set(name, (serviceByName.get(name) || 0) + Number(t.amount_paid || 0))
  })

  const monthEvents = events.filter((e) => inRange(`${e.event_date}T12:00:00+08:00`))
  const upcomingEvents = events
    .filter((e) => new Date(`${e.event_date}T00:00:00+08:00`).getTime() > range.endMs - 1)
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
    .slice(0, 6)

  const monthDocuments = documents.filter((d) => inRange(d.created_at))

  return {
    month,
    range,
    kpis: {
      totalIncome,
      totalExpenses,
      netIncome,
      totalOutstanding,
    },
    income: {
      duesIncome,
      serviceIncome,
      serviceByName: Array.from(serviceByName.entries()).map(([name, amount]) => ({ name, amount })),
      totalIncome,
    },
    expenses: {
      byCategory: expenseCategories,
      entries: monthlyExpenses,
      totalExpenses,
      entryCount: monthlyExpenses.length,
    },
    receivables: {
      duesIncome,
      serviceIncome,
      totalOutstanding,
      outstandingAccountCount: outstandingAccounts.length,
    },
    events: {
      thisMonth: monthEvents,
      upcoming: upcomingEvents,
    },
    documents: {
      thisMonth: monthDocuments,
    },
    untrackedModules,
  }
}