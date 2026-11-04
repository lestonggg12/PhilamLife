
const cents = (value) => {
  if (value == null || String(value).trim() === '') {
    throw new Error('An annual financial amount is missing.')
  }
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim())
  if (!match) throw new Error('Invalid annual financial amount.')
  const absolute = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'))
  if (!Number.isSafeInteger(absolute)) throw new Error('Annual amount is outside the supported range.')
  return match[1] === '-' ? -absolute : absolute
}

export const annualMoney = (value) =>
  'PHP ' + Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })

export function annualReportTotals(year, collections, expenses, currentMonth) {
  const selected = String(year)
  if (!/^20\d{2}$/.test(selected) ||
      !Array.isArray(collections) || !Array.isArray(expenses)) {
    throw new Error('Annual report source records are incomplete.')
  }

  const rows = Array.from({ length: 12 }, (_, index) => ({
    month: selected + '-' + String(index + 1).padStart(2, '0'),
    homeownerCents: 0, serviceCents: 0, expenseCents: 0,
  }))
  const byMonth = new Map(rows.map((row) => [row.month, row]))
  const seen = new Set()

  for (const item of collections) {
    const date = String(item.month_start || '')
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(date)) {
      throw new Error('Invalid collection month.')
    }
    const key = date.slice(0, 7)
    if (!byMonth.has(key) || seen.has(key)) {
      throw new Error('Duplicate or out-of-period collection summary.')
    }
    seen.add(key)
    // Ignore future periods: an annual year-to-date figure cannot contain
    // collections hidden behind a future-month placeholder.
    if (key > currentMonth) continue
    const row = byMonth.get(key)
    row.homeownerCents = cents(item.dues_collected)
    row.serviceCents = cents(item.service_collected)
  }

  for (const expense of expenses) {
    const key = String(expense.expense_date || '').slice(0, 7)
    if (!byMonth.has(key) || !/^\d{4}-\d{2}-\d{2}$/.test(String(expense.expense_date || ''))) {
      throw new Error('Expense falls outside the reporting year.')
    }
    if (String(expense.status || '').trim().toLowerCase() === 'voided' || key > currentMonth) continue
    byMonth.get(key).expenseCents += cents(expense.amount)
  }

  const months = rows.map((row) => {
    const income = row.homeownerCents + row.serviceCents
    return {
      month: row.month,
      homeowner: row.homeownerCents / 100,
      service: row.serviceCents / 100,
      income: income / 100,
      expenses: row.expenseCents / 100,
      net: (income - row.expenseCents) / 100,
      future: row.month > currentMonth,
    }
  })

  const sum = (key) => months.reduce((acc, row) => acc + cents(row[key]), 0) / 100

  return {
    year: selected,
    months,
    homeowner: sum('homeowner'),
    service: sum('service'),
    income: sum('income'),
    expenses: sum('expenses'),
    net: sum('net'),
    yearToDate: selected === currentMonth.slice(0, 4),
    preparedFor: currentMonth,
  }
}


import { computeMonthlyReportData, verifyReportReceivables, reportText, untrackedModules } from './monthlyReportData'

export function buildAnnualReportView({
  year, currentMonth, collections, payments, serviceTransactions, expenses,
  properties, overdue, credits, documents, events, grievances, datePrepared,
}) {
  if (![payments, serviceTransactions, expenses, properties, overdue, documents, events, collections].every(Array.isArray)) {
    throw new Error('Annual report supporting records are incomplete.')
  }
  verifyReportReceivables(properties, overdue, credits)
  const annual = annualReportTotals(year, collections, expenses, currentMonth)
  const detail = annual.months.map((row) => computeMonthlyReportData({
    month: row.month,
    payments: row.future ? [] : payments,
    serviceTransactions: row.future ? [] : serviceTransactions,
    expenses: row.future ? [] : expenses,
    properties, overdue, credits, documents: [], events: [],
  }))
  const sum = (items) => items.reduce((value, entry) => value + cents(entry), 0) / 100
  for (let i = 0; i < annual.months.length; i += 1) {
    const row = annual.months[i]
    const actual = detail[i].kpis
    if (cents(row.income) !== cents(actual.totalIncome) ||
        cents(row.expenses) !== cents(actual.totalExpenses)) {
      throw new Error('Annual report amounts disagree with the underlying monthly transactions.')
    }
  }
  const duesIncome = sum(detail.map((r) => r.income.duesIncome))
  const balanceIncome = sum(detail.map((r) => r.income.balanceIncome))
  const feesIncome = sum(detail.map((r) => r.income.feesIncome))
  const serviceIncome = sum(detail.map((r) => r.income.serviceIncome))
  const fees = new Map(), services = new Map(), categories = new Map()
  for (const report of detail) {
    for (const fee of report.income.feeBreakdown) {
      fees.set(fee.name, (fees.get(fee.name) || 0) + cents(fee.amount))
    }
    for (const service of report.income.serviceByName) {
      services.set(service.name, (services.get(service.name) || 0) + cents(service.amount))
    }
    for (const cat of report.expenses.byCategory) {
      const old = categories.get(cat.category) || { count: 0, centavos: 0 }
      categories.set(cat.category, { count: old.count + cat.count, centavos: old.centavos + cents(cat.amount) })
    }
  }
  const feeBreakdown = [...fees].map(([name, centavos]) => ({ name, amount: centavos / 100 }))
  const serviceByName = [...services].map(([name, centavos]) => ({ name, amount: centavos / 100 }))
  const byCategory = [...categories].map(([category, entry]) => ({ category, count: entry.count, amount: entry.centavos / 100 }))
    .sort((a, b) => b.amount - a.amount)
  if ([duesIncome, balanceIncome, feesIncome, serviceIncome].reduce((total, amount) => total + cents(amount), 0) !== cents(annual.income)) {
    throw new Error('Annual revenue categories do not match the collected income.')
  }
  if (byCategory.reduce((total, item) => total + cents(item.amount), 0) !== cents(annual.expenses)) {
    throw new Error('Annual expense categories do not match the recorded expenses.')
  }
  const first = String(year) + '-01-01T00:00:00+08:00'
  const after = String(Number(year) + 1) + '-01-01T00:00:00+08:00'
  const inYear = (value) => {
    const time = new Date(value).getTime()
    return Number.isFinite(time) && time >= Date.parse(first) && time < Date.parse(after)
  }
  const expenseEntries = expenses.filter((e) =>
    String(e.status || '').toLowerCase().trim() !== 'voided' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(e.expense_date || '')) &&
    String(e.expense_date).slice(0, 4) === String(year))
    .sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)))
  const yearlyEvents = events.filter((e) => e.event_date && inYear(e.event_date + 'T12:00:00+08:00'))
    .sort((a, b) => String(a.event_date).localeCompare(String(b.event_date)))
  const yearlyDocuments = documents.filter((d) => inYear(d.created_at))
  const receivables = detail[0].receivables
  const report = {
    year: String(year), annual, month: String(year) + '-01', monthlySummary: annual.months,
    kpis: { totalIncome: annual.income, totalExpenses: annual.expenses, netIncome: annual.net,
      totalOutstanding: detail[0].kpis.totalOutstanding },
    income: { duesIncome, balanceIncome, feesIncome, feeBreakdown, serviceIncome, serviceByName,
      totalIncome: annual.income },
    expenses: { byCategory, entries: expenseEntries, totalExpenses: annual.expenses,
      entryCount: expenseEntries.length },
    receivables: { ...receivables, duesIncome, balanceIncome, feesIncome, serviceIncome },
    events: { thisMonth: yearlyEvents, upcoming: [] },
    documents: { thisMonth: yearlyDocuments }, grievances, untrackedModules,
  }
  const narration = reportText(report, { monthLabel: String(year), datePrepared })
  report.narrative = {
    ...narration,
    overview: narration.overview.replace(
      /[^.]*community events? (?:is|are) scheduled for the period./,
      ' ' + yearlyEvents.length + ' community event' + (yearlyEvents.length === 1 ? ' was' : 's were') + ' recorded during the reporting year.'
    ),
    basis: narration.basis + ' Current outstanding balances and advance credits are as of the date prepared, not December 31 of the selected year. Verified historical year-end snapshots are unavailable.',
  }
  return report
}

/**
 * Combine twelve authorized, month-scoped grievance summaries.
 * Flow counts are additive; opening/closing balances are snapshots.
 * This function never accesses confidential case-level information.
 */
export function summarizeAnnualGrievances(year, summaries) {
  if (!Array.isArray(summaries) || summaries.length !== 12) {
    throw new Error('Twelve monthly grievance summaries are required.')
  }

  const movementKeys = [
    'received', 'reopened', 'resolved', 'dismissed', 'withdrawn',
  ]

  const result = {
    from: String(year) + '-01-01',
    to: null,
    not_started: true,
    opening: 0,
    received: 0,
    reopened: 0,
    resolved: 0,
    dismissed: 0,
    withdrawn: 0,
    closing: 0,
    over_30_days: 0,
  }

  let startedCount = 0

  summaries.forEach((summary, index) => {
    const month = String(index + 1).padStart(2, '0')
    const expectedFrom = String(year) + '-' + month + '-01'

    if (!summary || summary.from !== expectedFrom ||
        typeof summary.not_started !== 'boolean') {
      throw new Error('Monthly grievance summary is incomplete.')
    }

    if (summary.not_started) return

    if (startedCount !== index || !summary.to ||
        String(summary.to).slice(0, 7) !== expectedFrom.slice(0, 7)) {
      throw new Error('Monthly grievance periods are inconsistent.')
    }

    for (const key of [
      'opening', ...movementKeys, 'closing', 'over_30_days',
    ]) {
      const number = Number(summary[key])
      if (summary[key] == null ||
          !Number.isSafeInteger(number) || number < 0) {
        throw new Error('Monthly grievance counts are invalid.')
      }
    }

    if (startedCount === 0) {
      result.opening = Number(summary.opening)
    }

    for (const key of movementKeys) {
      result[key] += Number(summary[key])
      if (!Number.isSafeInteger(result[key])) {
        throw new Error('Annual grievance count exceeds the supported range.')
      }
    }

    result.closing = Number(summary.closing)
    result.over_30_days = Number(summary.over_30_days)
    result.to = summary.to
    result.not_started = false
    startedCount += 1
  })

  return result
}
