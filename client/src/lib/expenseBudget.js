// Exactly the existing expense-entry categories. A missing annual allocation
// means 'Not recorded', whereas an explicitly approved 0 is a true zero budget.
export const EXPENSE_BUDGET_CATEGORIES = Object.freeze([
  'Utilities', 'Maintenance & Repairs', 'Security', 'Salaries & Honoraria',
  'Supplies', 'Waste Management', 'Insurance', 'Events & Community',
  'Professional Fees', 'Other',
])
export const isBudgetAmount = value => /^\d{1,12}(\.\d{1,2})?$/.test(String(value).trim())

export function moneyToCents(value) {
  if (!isBudgetAmount(value)) throw Error('Budget amount must be nonnegative, with at most 2 decimals.')
  const [whole, decimal = ''] = String(value).split('.')
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw Error('Budget amount exceeds supported precision.')
  return cents
}

// Stable month-by-month centavo split; the 12 months always sum to the
// approved annual budget, even when the budget isn't divisible by 12.
export function monthlyBudgetCents(annualAmount, month) {
  const total = moneyToCents(annualAmount)
  if (!Number.isInteger(month) || month < 1 || month > 12) throw Error('Invalid budget month.')
  return Math.floor(total / 12) + (month <= total % 12 ? 1 : 0)
}

export function budgetComparison(expenses, budgets, month, amountCents, currency) {
  if (!Array.isArray(expenses) || !Array.isArray(budgets)) throw Error('Budget comparison sources unavailable.')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Invalid report month.')
  const budgetByCategory = new Map()
  for (const b of budgets) {
    if (!EXPENSE_BUDGET_CATEGORIES.includes(b.category) ||
        Number(b.budget_year) !== Number(month.slice(0, 4)) ||
        budgetByCategory.has(b.category)) throw Error('Inconsistent approved budget records.')
    budgetByCategory.set(b.category, monthlyBudgetCents(b.approved_annual_amount, Number(month.slice(5, 7))))
  }
  const actuals = new Map()
  for (const e of expenses) {
    const category = String(e.category || '').trim() || 'Not recorded'
    actuals.set(category, (actuals.get(category) || 0) + amountCents(e.amount))
  }
  const categories = EXPENSE_BUDGET_CATEGORIES.filter(c => actuals.has(c) || budgetByCategory.has(c))
  for (const category of actuals.keys()) if (!categories.includes(category)) categories.push(category)
  let approved = 0, actual = 0, complete = categories.length > 0
  const rows = categories.map(category => {
    const spent = actuals.get(category) || 0
    actual += spent
    const allocated = budgetByCategory.get(category)
    if (allocated === undefined) { complete = false; return [category, 'Not recorded', currency(spent), 'Cannot calculate'] }
    approved += allocated
    return [category, currency(allocated), currency(spent), currency(allocated - spent)]
  })
  if (complete) rows.push(['Total',currency(approved),currency(actual),currency(approved - actual)])
  return { rows, recorded: budgetByCategory.size, complete, hasBudgets: budgetByCategory.size > 0 }
}
