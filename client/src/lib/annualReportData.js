
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
    const row = byMonth.get(key)
    row.homeownerCents = cents(item.dues_collected)
    row.serviceCents = cents(item.service_collected)
  }

  for (const expense of expenses) {
    const key = String(expense.expense_date || '').slice(0, 7)
    if (!byMonth.has(key) || !/^\d{4}-\d{2}-\d{2}$/.test(String(expense.expense_date || ''))) {
      throw new Error('Expense falls outside the reporting year.')
    }
    if (String(expense.status || '').trim().toLowerCase() === 'voided') continue
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
