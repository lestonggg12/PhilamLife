import { accountStatus, groupChargesByProperty } from './latepenalty'

// Pure data computation for the HOA Monthly Report.
// No rendering here — ReportsPage (on-screen preview) and monthlyReportPdf.js
// (PDF export) both consume this so the two always show identical figures.
//
// Only sections backed by real, queryable records are computed. Areas with no
// module yet are listed once in `untrackedModules` instead of being shown as zero.

export const REPORT_STATUS = 'Draft' // No approval workflow exists yet, so a report can never be Approved/Final.

const DAY_MS = 24 * 60 * 60 * 1000

export function monthBounds(month) {
  const [year, monthNumber] = month.split('-').map(Number)
  const nextYear = monthNumber === 12 ? year + 1 : year
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1
  const nextKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}`
  return {
    start: `${month}-01T00:00:00+08:00`,
    end: `${nextKey}-01T00:00:00+08:00`,
    startDate: `${month}-01`,
    endDate: `${nextKey}-01`, // exclusive
    lastDate: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10), // inclusive
    startMs: new Date(`${month}-01T00:00:00+08:00`).getTime(),
    endMs: new Date(`${nextKey}-01T00:00:00+08:00`).getTime(),
  }
}

export function manilaDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export const previousMonth = (month) => {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
export const sameMonthLastYear = (month) => {
  const [y, m] = month.split('-')
  return `${Number(y) - 1}-${m}`
}

export const untrackedModules = [
  'Cash & bank account balances and bank reconciliation',
  'Accounts payable (supplier / service-provider invoices)',
  'Budget vs. actual (no approved budget module)',
  'Maintenance & facility requests',
  'Violations & compliance (no entry screen yet)',
  'Security & incident reports',
  'Capital projects',
  'Reserve fund activity',
  'Board meetings & action items',
  'Event cancellation status and attendance',
  'Report review / approval workflow',
]

// Money is added up in whole centavos so decimals like 0.1 + 0.2 never leak into a total.
const toCents = (value) => Math.round((Number(value) || 0) * 100)
const fromCents = (cents) => cents / 100

// Payments saved before charge types existed reduced the dues balance, so they count as dues.
const DUES_LABEL = 'Association Dues'
const paymentCategory = (payment) => String(payment.charge_type || '').trim() || DUES_LABEL

const isVoidedPayment = (p) => String(p.status || '').toLowerCase() === 'voided'
const isVoidedService = (t) => String(t.payment_status || '').toLowerCase() === 'voided'
const isVoidedExpense = (e) => String(e.status || '').toLowerCase() === 'voided'

function makeInRange(month) {
  const range = monthBounds(month)
  return (iso) => {
    if (!iso) return false
    const ms = new Date(iso).getTime()
    return ms >= range.startMs && ms < range.endMs
  }
}

/** Income / expense totals for one month. Used for the current month and for comparisons. */
export function summarizePeriod({ payments = [], serviceTransactions = [], expenses = [], month }) {
  const inRange = makeInRange(month)
  const p = payments.filter((x) => !isVoidedPayment(x) && inRange(x.paid_at))
  const s = serviceTransactions.filter((x) => !isVoidedService(x) && inRange(x.paid_at))
  const e = expenses.filter((x) => !isVoidedExpense(x) && inRange(`${x.expense_date}T12:00:00+08:00`))
  const incomeCents = p.reduce((sum, x) => sum + toCents(x.amount_paid ?? x.amount), 0) + s.reduce((sum, x) => sum + toCents(x.amount_paid), 0)
  const expenseCents = e.reduce((sum, x) => sum + toCents(x.amount), 0)
  return {
    month,
    income: fromCents(incomeCents),
    expenses: fromCents(expenseCents),
    net: fromCents(incomeCents - expenseCents),
    recordCount: p.length + s.length + e.length,
    hasData: p.length + s.length + e.length > 0,
  }
}

/** Change between two amounts. Safe for missing data and a zero starting point. */
export function compareAmounts(current, prior, priorHasData) {
  if (!priorHasData) return { available: false, prior: null, change: null, percent: null }
  const change = fromCents(toCents(current) - toCents(prior))
  const percent = toCents(prior) === 0 ? null : (change / Math.abs(Number(prior))) * 100
  return { available: true, prior: Number(prior), change, percent }
}

function groupCount(list, keyFn, centsFn) {
  const map = new Map()
  list.forEach((item) => {
    const key = keyFn(item)
    const cur = map.get(key) || { name: key, count: 0, cents: 0 }
    cur.count += 1
    cur.cents += centsFn(item)
    map.set(key, cur)
  })
  return map
}

const AGING_BUCKETS = [
  { key: 'b1', label: '1–30 days', min: 1, max: 30 },
  { key: 'b2', label: '31–60 days', min: 31, max: 60 },
  { key: 'b3', label: '61–90 days', min: 61, max: 90 },
  { key: 'b4', label: 'Over 90 days', min: 91, max: Infinity },
]

/**
 * @param {object} raw
 * @param {Array}  raw.payments / serviceTransactions / expenses  - records for the month (voided excluded again here)
 * @param {Array}  raw.properties, raw.charges (non-voided), raw.settings
 * @param {Array}  raw.documents, raw.events (month events + later events)
 * @param {Array}  raw.collectionActions, raw.accountingPeriods
 * @param {object} raw.comparisonData  - { previous: {payments, serviceTransactions, expenses}, lastYear: {...} }
 * @param {string} raw.month           - 'YYYY-MM'
 * @param {Date}   raw.asOf            - data cutoff (defaults to now)
 */
export function computeMonthlyReportData(raw) {
  const {
    payments = [], serviceTransactions = [], expenses = [], properties = [], charges = [], settings = null,
    documents = [], events = [], collectionActions = [], accountingPeriods = [], comparisonData = null,
    month, asOf = new Date(),
  } = raw
  const range = monthBounds(month)
  const inRange = makeInRange(month)
  const today = manilaDateString(asOf)

  // ---------- period & status ----------
  const isCurrentMonth = today >= range.startDate && today < range.endDate
  const isFutureMonth = today < range.startDate
  const reportType = isCurrentMonth ? 'Month-to-date (preliminary)' : isFutureMonth ? 'Future period (no data expected)' : 'Full month'
  const periodEnd = isCurrentMonth ? today : range.lastDate
  const accountingPeriod = (accountingPeriods || []).find((p) => p.starts_on <= range.startDate && p.ends_on >= range.lastDate) || null
  const dataStatus = accountingPeriod?.status === 'closed'
    ? 'Closed accounting period'
    : 'Preliminary — accounting period not closed, figures not reconciled or audited'

  // ---------- month records (voided excluded) ----------
  const monthlyPayments = payments.filter((p) => !isVoidedPayment(p) && inRange(p.paid_at))
  const monthlyServices = serviceTransactions.filter((t) => !isVoidedService(t) && inRange(t.paid_at))
  const monthlyExpenses = expenses
    .filter((e) => !isVoidedExpense(e) && inRange(`${e.expense_date}T12:00:00+08:00`))
    .sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)))

  // ---------- income ----------
  const paymentGroups = groupCount(monthlyPayments, paymentCategory, (p) => toCents(p.amount_paid ?? p.amount))
  const duesGroup = paymentGroups.get(DUES_LABEL) || { count: 0, cents: 0 }
  const feeEntries = Array.from(paymentGroups.values())
    .filter((g) => g.name !== DUES_LABEL)
    .map((g) => ({ name: g.name, count: g.count, amount: fromCents(g.cents) }))
    .sort((a, b) => b.amount - a.amount)
  const feesCents = feeEntries.reduce((s, f) => s + toCents(f.amount), 0)
  const feesCount = feeEntries.reduce((s, f) => s + f.count, 0)

  const serviceGroups = groupCount(monthlyServices, (t) => t.service_name || 'Other', (t) => toCents(t.amount_paid))
  const serviceByName = Array.from(serviceGroups.values()).map((g) => ({ name: g.name, count: g.count, amount: fromCents(g.cents) }))
  const serviceCents = serviceByName.reduce((s, x) => s + toCents(x.amount), 0)
  const serviceCount = monthlyServices.length

  const incomeCents = duesGroup.cents + feesCents + serviceCents
  const expenseCents = monthlyExpenses.reduce((s, e) => s + toCents(e.amount), 0)
  const totalIncome = fromCents(incomeCents)
  const totalExpenses = fromCents(expenseCents)
  const netIncome = fromCents(incomeCents - expenseCents)
  const incomeTransactionCount = duesGroup.count + feesCount + serviceCount

  // ---------- expenses ----------
  const expenseGroups = groupCount(monthlyExpenses, (e) => e.category || 'Uncategorized', (e) => toCents(e.amount))
  const expenseCategories = Array.from(expenseGroups.values())
    .map((g) => ({ category: g.name, count: g.count, amount: fromCents(g.cents) }))
    .sort((a, b) => b.amount - a.amount)

  // ---------- receivables (current balances as of the data cutoff) ----------
  const chargesByProperty = groupChargesByProperty(charges)
  const activeProperties = properties.filter((p) => (p.homeowner_status || 'active') === 'active')
  const accounts = activeProperties.map((property) => accountStatus(property, chargesByProperty, settings))
  const outstanding = accounts.filter((a) => a.balance > 0)
  const totalOutstandingCents = outstanding.reduce((s, a) => s + toCents(a.balance), 0)
  const overdueAccounts = outstanding.filter((a) => a.isOverdue)
  const overdueCents = overdueAccounts.reduce((s, a) => s + toCents(a.overdueAmount), 0)
  const aging = AGING_BUCKETS.map((b) => {
    const inBucket = overdueAccounts.filter((a) => a.daysOverdue >= b.min && a.daysOverdue <= b.max)
    return { label: b.label, accounts: inBucket.length, amount: fromCents(inBucket.reduce((s, a) => s + toCents(a.overdueAmount), 0)) }
  })

  // Billed this period: charges belonging to the report month (billing month, or date added for manual charges).
  const billedCharges = charges.filter((c) => (c.billing_month
    ? String(c.billing_month).slice(0, 7) === month
    : inRange(c.created_at)))
  const billedGroups = groupCount(billedCharges, (c) => c.charge_type || 'Other', (c) => toCents(c.amount))
  const billedByType = Array.from(billedGroups.values()).map((g) => ({ name: g.name, count: g.count, amount: fromCents(g.cents) }))
  const billedTotal = fromCents(Array.from(billedGroups.values()).reduce((s, g) => s + g.cents, 0))

  const actionGroups = groupCount(collectionActions.filter((a) => inRange(a.action_date)), (a) => a.action_type, () => 0)
  const collectionActionSummary = Array.from(actionGroups.values()).map((g) => ({ name: g.name, count: g.count }))
  const collectionActionCount = collectionActionSummary.reduce((s, g) => s + g.count, 0)

  // ---------- events (status comes from the date vs. the data cutoff) ----------
  const monthEvents = events.filter((e) => e.event_date >= range.startDate && e.event_date < range.endDate)
  const completedEvents = monthEvents.filter((e) => e.event_date < today).sort((a, b) => a.event_date.localeCompare(b.event_date))
  const todayEvents = monthEvents.filter((e) => e.event_date === today)
  const seen = new Set()
  const upcomingEvents = events
    .filter((e) => e.event_date > today)
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.event_date.localeCompare(b.event_date))

  const monthDocuments = documents.filter((d) => inRange(d.created_at))

  // ---------- comparisons ----------
  const comparisons = comparisonData
    ? [
        ['Previous month', previousMonth(month), comparisonData.previous],
        ['Same month last year', sameMonthLastYear(month), comparisonData.lastYear],
      ].map(([label, key, data]) => {
        const prior = summarizePeriod({ ...(data || {}), month: key })
        return {
          label,
          month: key,
          hasData: prior.hasData,
          income: compareAmounts(totalIncome, prior.income, prior.hasData),
          expenses: compareAmounts(totalExpenses, prior.expenses, prior.hasData),
          net: compareAmounts(netIncome, prior.net, prior.hasData),
        }
      })
    : []

  // ---------- reconciliation: summary totals must equal their detail rows ----------
  const incomeRowCents = duesGroup.cents + feeEntries.reduce((s, f) => s + toCents(f.amount), 0) + serviceByName.reduce((s, x) => s + toCents(x.amount), 0)
  const reconciliation = {
    incomeMatches: incomeRowCents === incomeCents,
    expensesMatch: expenseCategories.reduce((s, c) => s + toCents(c.amount), 0) === expenseCents
      && monthlyExpenses.reduce((s, e) => s + toCents(e.amount), 0) === expenseCents,
  }

  const kpis = {
    totalIncome,
    totalExpenses,
    netIncome,
    totalOutstanding: fromCents(totalOutstandingCents),
    outstandingAccountCount: outstanding.length,
    overdueAccountCount: overdueAccounts.length,
    completedEventCount: completedEvents.length,
    upcomingEventCount: upcomingEvents.length,
  }

  const report = {
    month,
    range,
    asOf,
    today,
    meta: {
      status: REPORT_STATUS,
      reportType,
      periodStart: range.startDate,
      periodEnd,
      dataStatus,
      accountingPeriodStatus: accountingPeriod ? accountingPeriod.status : null,
    },
    kpis,
    income: {
      duesIncome: fromCents(duesGroup.cents),
      duesCount: duesGroup.count,
      feesIncome: fromCents(feesCents),
      feeBreakdown: feeEntries,
      serviceIncome: fromCents(serviceCents),
      serviceByName,
      totalIncome,
      transactionCount: incomeTransactionCount,
    },
    expenses: { byCategory: expenseCategories, entries: monthlyExpenses, totalExpenses, entryCount: monthlyExpenses.length },
    receivables: {
      duesIncome: fromCents(duesGroup.cents),
      feesIncome: fromCents(feesCents),
      serviceIncome: fromCents(serviceCents),
      totalCollected: totalIncome,
      billedByType,
      billedTotal,
      totalOutstanding: fromCents(totalOutstandingCents),
      outstandingAccountCount: outstanding.length,
      overdueAccountCount: overdueAccounts.length,
      overdueAmount: fromCents(overdueCents),
      notYetDueAmount: fromCents(totalOutstandingCents - overdueCents),
      aging,
      collectionActionSummary,
      collectionActionCount,
    },
    comparisons,
    events: { thisMonth: monthEvents, completed: completedEvents, today: todayEvents, upcoming: upcomingEvents },
    documents: { thisMonth: monthDocuments },
    reconciliation,
    untrackedModules,
  }
  report.commentary = buildCommentary(report)
  return report
}

const fmt = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const peso = (v) => `PHP ${fmt.format(Number(v || 0))}`

/** Facts and suggested actions come only from calculated values — no invented reasons. */
function buildCommentary(report) {
  const { kpis, receivables, comparisons, expenses, meta } = report
  const facts = []
  facts.push(`Recorded income was ${peso(kpis.totalIncome)} from ${report.income.transactionCount} transaction(s) against recorded expenses of ${peso(kpis.totalExpenses)} (${expenses.entryCount} entr${expenses.entryCount === 1 ? 'y' : 'ies'}), a net operating ${kpis.netIncome >= 0 ? 'surplus' : 'deficit'} of ${peso(Math.abs(kpis.netIncome))}. This is not a cash-on-hand figure; cash and bank balances are not tracked.`)
  comparisons.forEach((c) => {
    if (!c.hasData) {
      facts.push(`${c.label}: no income or expense records exist for that period, so no comparison is shown.`)
      return
    }
    const pct = (x) => (x.percent === null ? 'n/a' : `${x.percent >= 0 ? '+' : ''}${x.percent.toFixed(1)}%`)
    facts.push(`${c.label}: income changed by ${peso(c.income.change)} (${pct(c.income)}) and expenses by ${peso(c.expenses.change)} (${pct(c.expenses)}).`)
  })
  if (expenses.byCategory.length) {
    const top = expenses.byCategory[0]
    facts.push(`Largest expense category: ${top.category} at ${peso(top.amount)} (${top.count} entr${top.count === 1 ? 'y' : 'ies'}).`)
  }
  facts.push(`${receivables.outstandingAccountCount} active account(s) carry a balance totalling ${peso(receivables.totalOutstanding)}; ${receivables.overdueAccountCount} account(s) are past their due date with ${peso(receivables.overdueAmount)} overdue (balances are current as of the data cutoff).`)

  const recommendations = []
  if (receivables.overdueAccountCount > 0) {
    recommendations.push({
      issue: `${receivables.overdueAccountCount} overdue account(s), ${peso(receivables.overdueAmount)} overdue`,
      action: `Continue collection follow-ups (${receivables.collectionActionCount} follow-up(s) logged this month).`,
    })
  }
  if (kpis.netIncome < 0) {
    recommendations.push({ issue: `Net operating deficit of ${peso(Math.abs(kpis.netIncome))}`, action: 'Review the expense detail for this period.' })
  }
  if (!report.reconciliation.incomeMatches || !report.reconciliation.expensesMatch) {
    recommendations.push({ issue: 'Summary totals do not match their detail rows', action: 'Investigate before distributing this report.' })
  }
  if (report.month < report.today.slice(0, 7) && meta.accountingPeriodStatus !== 'closed') {
    recommendations.push({ issue: 'This past period has not been closed', action: 'Review the figures and close the accounting period if they are correct.' })
  }
  return { facts, recommendations }
}

// Rows for the income table: [category, transaction count, amount]. Shared by preview and PDF.
export function incomeTableRows(income, formatMoney) {
  return [
    [DUES_LABEL, String(income.duesCount), formatMoney(income.duesIncome)],
    ...income.feeBreakdown.map((f) => [`Fees & Charges — ${f.name}`, String(f.count), formatMoney(f.amount)]),
    ...income.serviceByName.map((s) => [`Amenity / Service — ${s.name}`, String(s.count), formatMoney(s.amount)]),
    ['Total Income', String(income.transactionCount), formatMoney(income.totalIncome)],
  ]
}

// Rows for the comparison table: [period, prior income, income change, prior expenses, expense change].
export function comparisonTableRows(comparisons, formatMoney) {
  const pct = (x) => (x.percent === null ? 'n/a' : `${x.percent >= 0 ? '+' : ''}${x.percent.toFixed(1)}%`)
  const change = (x) => `${x.change >= 0 ? '+' : '-'}${formatMoney(Math.abs(x.change))} (${pct(x)})`
  return comparisons.map((c) => (c.hasData
    ? [`${c.label} (${c.month})`, formatMoney(c.income.prior), change(c.income), formatMoney(c.expenses.prior), change(c.expenses)]
    : [`${c.label} (${c.month})`, 'No records', '—', 'No records', '—']))
}