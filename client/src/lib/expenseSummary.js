// Exact-cent summaries for Supabase NUMERIC amounts. Never replace malformed
// financial data with zero, or add peso floats in reporting totals.
export function expenseCents(value) {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(String(value ?? '').trim())
  if (!match) throw new Error('Expense amount is missing or invalid.')
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('Expense amount exceeds the supported range.')
  return cents
}

export function parseExpenseAmount(value) {
  const cents = expenseCents(value)
  if (cents <= 0) throw new Error('Enter an amount greater than zero.')
  return cents / 100
}

export function isValidExpenseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isVoidedExpense(expense) {
  return String(expense?.status ?? '').trim().toLowerCase() === 'voided'
}

export function summarizeExpenses(rows, selectedMonth) {
  const categories = new Map()
  let all = 0
  let monthly = 0
  let count = 0
  for (const expense of rows) {
    const amount = expenseCents(expense.amount)
    if (!isValidExpenseDate(expense.expense_date)) throw new Error('Expense history includes an invalid date.')
    if (isVoidedExpense(expense)) continue
    all += amount
    if (!Number.isSafeInteger(all)) throw new Error('Expense total exceeds the supported range.')
    if (!expense.expense_date.startsWith(selectedMonth)) continue
    monthly += amount
    if (!Number.isSafeInteger(monthly)) throw new Error('Monthly expense total exceeds the supported range.')
    count += 1
    const category = expense.category || 'Uncategorized'
    const next = (categories.get(category) || 0) + amount
    if (!Number.isSafeInteger(next)) throw new Error('Expense category total exceeds the supported range.')
    categories.set(category, next)
  }
  const top = [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return {
    totalAllTime: all / 100,
    totalSelectedMonth: monthly / 100,
    count,
    topCategory: top ? { name: top[0], amount: top[1] / 100 } : null,
  }
}
