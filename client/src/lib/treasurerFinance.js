import { fetchAll } from './fetchAll'

const fail = (label, message) => new Error(`${label}: ${message || 'could not load data'}`)
async function read(label, query, { allowNull = false } = {}) {
  try {
    const result = await query()
    if (result.error) throw result.error
    if (result.data == null && !allowNull) {
      throw new Error('response is missing')
    }
    return result.data
  } catch (error) { throw fail(label, error?.message) }
}
function cents(value, label) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) throw fail(label, 'amount is unavailable')
  const result = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(result)) throw fail(label, 'amount is outside the supported range')
  return result
}
export function transactionPaymentStatus(transaction, owedIds) {
  const status = String(transaction.payment_status || '').toLowerCase()
  if (status === 'voided') return 'voided'
  if (status === 'partial') return owedIds.has(transaction.id) ? 'outstanding' : 'paid'
  return status === 'paid' || Number(transaction.amount_paid) >= Number(transaction.amount_due) ? 'paid' : 'outstanding'
}

export function summarizeAging(properties, rows) {
  const byId = new Map(rows.map((row) => [String(row.property_id), row]))
  const totals = { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days90Plus: 0 }
  const columns = { current: 'current_amount', days1To30: 'days_1_30_amount', days31To60: 'days_31_60_amount', days61To90: 'days_61_90_amount', days90Plus: 'days_90_plus_amount' }
  let outstanding = 0, overdueAccounts = 0
  for (const property of properties.filter((p) => (p.homeowner_status || 'active') === 'active')) {
    const row = byId.get(String(property.id))
    if (!row || row.aging_complete !== true) throw fail('Aging overview', 'source amounts do not reconcile or the database update is missing. Refresh after verification')
    const balance = cents(row.balance, 'Aging balance')
    if (balance !== Math.max(cents(property.current_balance ?? 0, 'Account balance'), 0)) throw fail('Aging overview', 'records changed while loading. Refresh to try again')
    let sum = 0
    for (const [key, column] of Object.entries(columns)) {
      const value = cents(row[column], 'Aging bucket')
      if (value < 0) throw fail('Aging overview', 'a bucket is negative')
      totals[key] += value; sum += value
    }
    if (sum !== balance) throw fail('Aging overview', 'buckets do not match the recorded balance')
    outstanding += balance
    if (row.is_overdue) overdueAccounts++
  }
  for (const key of Object.keys(totals)) totals[key] /= 100
  return { outstanding: outstanding / 100, aging: totals, overdue: totals.days1To30 + totals.days31To60 + totals.days61To90 + totals.days90Plus, overdueAccounts }
}

export function summarizeTreasurerMonth(monthly, expenses, monthStart) {
  const monthKey = String(monthStart).slice(0, 7)

  const collected = cents(
    monthly?.dues_collected ?? 0,
    'Monthly collections'
  )

  const services = cents(
    monthly?.service_collected ?? 0,
    'Monthly services'
  )

  const expensesTotal = expenses
    .filter((row) =>
      String(row.status || '').toLowerCase() !== 'voided'
      && String(row.expense_date || row.created_at || '')
        .slice(0, 7) === monthKey
    )
    .reduce(
      (total, row) => total + cents(row.amount, 'Expense amount'),
      0
    )

  return {
    collectedThisMonth: collected / 100,
    servicesThisMonth: services / 100,
    expensesThisMonth: expensesTotal / 100,
    netThisMonth: (collected + services - expensesTotal) / 100,
  }
}

export async function loadTreasurerDashboard(client, monthStart) {
  const all = (table, order, options = {}) => read(table, () => fetchAll(() => {
    const query = client.from(table).select('*')
    return order ? query.order(order, { ascending: false }) : query
  }, options))
  const [payments, expenses, services, monthly, properties, overdue, credits, adjustments, deposits, periods] = await Promise.all([
    read('Recent payments', () => client.from('payments').select('*').neq('status', 'Voided').order('paid_at', { ascending: false }).limit(8)),
    all('expenses', 'expense_date'),
    read('Recent services', () => client.from('service_transactions').select('*').not('payment_status', 'ilike', 'voided').order('paid_at', { ascending: false }).limit(8)),
    read('Monthly collections', () => client.from('monthly_collections').select('month_start, dues_collected, service_collected').eq('month_start', monthStart).maybeSingle(), { allowNull: true }),
    all('properties', 'homeowner_name'), all('property_overdue_summary', 'property_id', { tiebreaker: null }),
    read('Advance credits', () => client.from('credit_liability_summary').select('*').maybeSingle()),
    all('account_adjustments', 'created_at'), all('bank_deposits', 'recorded_at'), all('accounting_periods', 'starts_on'),
  ])
  if (monthly) { cents(monthly.dues_collected, 'Monthly collections'); cents(monthly.service_collected, 'Monthly services') }
  for (const expense of expenses || []) cents(expense.amount, 'Expense amount')
  if (!credits) throw fail('Advance credits', 'summary is unavailable')
  cents(credits.active_credit_total, 'Advance credits')
  return { payments: payments || [], expenses: expenses || [], services: services || [], monthly, properties: properties || [], overdue: overdue || [], credits, adjustments: adjustments || [], deposits: deposits || [], periods: periods || [], agingSummary: summarizeAging(properties || [], overdue || []) }
}

export async function loadServiceRevenue(client, { fromDate = '', toDate = '' } = {}) {
  const [transactions, summary, balances] = await Promise.all([
    read('Service receipts', () => fetchAll(() => {
      let query = client.from('service_transactions').select('*').order('paid_at', { ascending: false })
      if (fromDate) query = query.gte('paid_at', `${fromDate}T00:00:00+08:00`)
      if (toDate) query = query.lte('paid_at', `${toDate}T23:59:59.999+08:00`)
      return query
    })),
    read('Service revenue summary', () => client.rpc('service_revenue_summary')),
    read('Unpaid service balances', () => fetchAll(() => client.from('service_balances').select('id, balance_due'))),
  ])
  if (!summary || !Array.isArray(summary.by_service)) throw fail('Service revenue summary', 'response is incomplete')
  const total = cents(summary.total_collected, 'Service total') / 100
  const month = cents(summary.collected_this_month, 'Monthly services') / 100
  const owed = (balances || []).reduce((sum, row) => sum + cents(row.balance_due, 'Unpaid service balance'), 0) / 100
  const byService = summary.by_service.map((row) => [row.name, cents(row.amount, 'Service breakdown') / 100])
  return { transactions: transactions || [], totals: { total, month, owed, byService }, owedIds: new Set((balances || []).map((row) => row.id)) }
}

export async function recordExpense(client, payload) {
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error('Enter a finite amount greater than zero.')
  const { data, error } = await client.from('expenses').insert(payload).select('*').single()
  if (error) throw error
  if (!data?.id) throw new Error('Expense creation could not be confirmed. Refresh before trying again.')
  return data
}
export async function voidExpense(client, id, reason) {
  const text = String(reason || '').trim()
  if (text.length < 5 || text.length > 500) throw new Error('Enter a cancellation reason of 5 to 500 characters.')
  const { data, error } = await client.from('expenses').update({ status: 'Voided', void_reason: text }).eq('id', id).neq('status', 'Voided').select('*').single()
  if (error) throw error
  if (!data?.id || String(data.id) !== String(id) || data.status !== 'Voided') throw new Error('The expense cancellation could not be confirmed. Refresh before trying again.')
  return data
}
