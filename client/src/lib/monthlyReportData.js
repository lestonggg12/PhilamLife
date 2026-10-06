import { accountStatus, groupChargesByProperty } from './latepenalty'

// Pure data computation for the HOA Monthly Report.
// No rendering here — both ReportsPage (on-screen) and monthlyReportPdf.js
// (PDF export) consume this so the two always show identical figures.
//
// Trimmed to real, calculable figures only. Anything without a built
// frontend feature yet (violations, maintenance, security, capital
// projects, board action items, reserve fund, budget vs. actual,
// collection rate) is disclosed once in `untrackedModules`, not repeated
// as N/A everywhere. Note: `violations` and `payment_allocations` tables
// already exist in the live schema with RLS — they just have no UI built
// against them yet, so they stay out of this report until they do.

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

// Money is added up in whole centavos so decimals like 0.1 + 0.2 can never
// leak into a report total.
const toCents = (value) => Math.round((Number(value) || 0) * 100)
const fromCents = (cents) => cents / 100

// Payments saved before charge types existed have no charge_type. Every one of
// them reduced the homeowner's dues balance, so they are reported as dues.
const DUES_LABEL = 'Association Dues'
const paymentCategory = (payment) => {
  const type = String(payment.charge_type || '').trim()
  return type || DUES_LABEL
}

/**
 * @param {object} raw
 * @param {Array} raw.payments        - already excludes voided; each row needs charge_type
 * @param {Array} raw.serviceTransactions
 * @param {Array} raw.expenses        - already excludes voided
 * @param {Array} raw.properties      - all property/lot records
 * @param {object} raw.settings      - system_settings row (dues_amount, due_day, grace_period_days, late_penalty)
 * @param {Array} raw.documents
 * @param {Array} raw.events
 * @param {string} raw.month          - 'YYYY-MM'
 */
export function computeMonthlyReportData(raw) {
  const { payments = [], serviceTransactions = [], expenses = [], properties = [], charges = [], settings = null, documents = [], events = [], month } = raw
  const range = monthBounds(month)

  const inRange = (iso) => {
    if (!iso) return false
    const ms = new Date(iso).getTime()
    return ms >= range.startMs && ms < range.endMs
  }

  const monthlyPayments = payments.filter((p) => inRange(p.paid_at))
  const monthlyServices = serviceTransactions.filter((t) =>
    inRange(t.paid_at) && String(t.payment_status || 'paid').toLowerCase() !== 'voided')
  const monthlyExpenses = expenses
    .filter((e) => inRange(`${e.expense_date}T12:00:00+08:00`))
    .sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date))

  // Homeowner payments, split by what they were for.
  const paymentCents = new Map()
  monthlyPayments.forEach((p) => {
    const category = paymentCategory(p)
    paymentCents.set(category, (paymentCents.get(category) || 0) + toCents(p.amount_paid ?? p.amount))
  })
  const duesCents = paymentCents.get(DUES_LABEL) || 0
  const feeEntries = Array.from(paymentCents.entries())
    .filter(([category]) => category !== DUES_LABEL)
    .map(([name, cents]) => ({ name, amount: fromCents(cents) }))
    .sort((a, b) => b.amount - a.amount)
  const feesCents = feeEntries.reduce((s, f) => s + toCents(f.amount), 0)

  const serviceCents = monthlyServices.reduce((s, t) => s + toCents(t.amount_paid), 0)
  const expenseCents = monthlyExpenses.reduce((s, e) => s + toCents(e.amount), 0)

  const duesIncome = fromCents(duesCents)
  const feesIncome = fromCents(feesCents)
  const serviceIncome = fromCents(serviceCents)
  const totalIncome = fromCents(duesCents + feesCents + serviceCents)
  const totalExpenses = fromCents(expenseCents)
  const netIncome = fromCents(duesCents + feesCents + serviceCents - expenseCents)

  const chargesByProperty = groupChargesByProperty(charges)
  const accountBalances = properties
    .filter((property) => (property.homeowner_status || 'active') === 'active')
    .map((property) => {
      const { balance, isOverdue } = accountStatus(property, chargesByProperty, settings)
      return { balance, isOverdue }
    })
  const outstandingAccounts = accountBalances.filter((a) => a.balance > 0)
  const totalOutstanding = outstandingAccounts.reduce((s, a) => s + a.balance, 0)

  const expenseByCategory = new Map()
  monthlyExpenses.forEach((e) => {
    const cat = e.category || 'Uncategorized'
    const current = expenseByCategory.get(cat) || { category: cat, count: 0, cents: 0 }
    current.count += 1
    current.cents += toCents(e.amount)
    expenseByCategory.set(cat, current)
  })
  const expenseCategories = Array.from(expenseByCategory.values())
    .map((c) => ({ category: c.category, count: c.count, amount: fromCents(c.cents) }))
    .sort((a, b) => b.amount - a.amount)

  const serviceByName = new Map()
  monthlyServices.forEach((t) => {
    const name = t.service_name || 'Other'
    serviceByName.set(name, (serviceByName.get(name) || 0) + toCents(t.amount_paid))
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
      feesIncome,
      feeBreakdown: feeEntries,
      serviceIncome,
      serviceByName: Array.from(serviceByName.entries()).map(([name, cents]) => ({ name, amount: fromCents(cents) })),
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
      feesIncome,
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

// Rows for the "2.1 Income" table, shared by the on-screen report and the PDF
// so both always list the same lines in the same order.
export function incomeTableRows(income, formatMoney) {
  return [
    [DUES_LABEL, formatMoney(income.duesIncome)],
    ...income.feeBreakdown.map((f) => [`Fees & Charges — ${f.name}`, formatMoney(f.amount)]),
    ...income.serviceByName.map((s) => [`Amenity / Service — ${s.name}`, formatMoney(s.amount)]),
    ['Total Income', formatMoney(income.totalIncome)],
  ]
}