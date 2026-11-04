import { describe, expect, it } from 'vitest'
import { loadServiceRevenue, loadTreasurerDashboard, summarizeAging, transactionPaymentStatus, recordExpense, voidExpense } from './treasurerFinance'
function client(overrides = {}, thrown = null) {
  const calls = []
  const defaults = { credit_liability_summary: { active_credit_total: 0 }, monthly_collections: null, service_revenue_summary: { total_collected: 100, collected_this_month: 100, by_service: [{ name: 'Hall', amount: 100 }] } }
  function result(table, range) {
    if (table === thrown) throw new Error('Offline')
    const value = Object.hasOwn(overrides, table) ? overrides[table] : Object.hasOwn(defaults, table) ? defaults[table] : []
    if (value?.error) return value
    return { data: range && Array.isArray(value) ? value.slice(range[0], range[1] + 1) : value, error: null }
  }
  const c = { calls, from(table) {
    const query = { select() { return this }, order() { return this }, neq() { return this }, eq() { return this }, limit() { return this }, gte() { return this }, lte() { return this }, maybeSingle() { return Promise.resolve().then(() => result(table)) }, range(a, b) { calls.push([table, a, b]); return Promise.resolve().then(() => result(table, [a, b])) }, then(a, b) { return Promise.resolve().then(() => result(table)).then(a, b) } }
    return query
  }, rpc(table) { return Promise.resolve().then(() => result(table)) } }
  return c
}
const error = { data: null, error: { message: 'Permission denied' } }
describe('Treasurer financial reads', () => {
  it('loads verified zero balances as zero', async () => {
    const d = await loadTreasurerDashboard(client(), '2026-11-01')
    expect(d.agingSummary.outstanding).toBe(0); expect(d.deposits).toEqual([])
  })
  it.each(['payments','expenses','service_transactions','monthly_collections','properties','property_overdue_summary','credit_liability_summary','account_adjustments','bank_deposits','accounting_periods'])('reports %s failures instead of empty clean results', async (table) => {
    await expect(loadTreasurerDashboard(client({ [table]: error }), '2026-11-01')).rejects.toThrow('Permission denied')
  })
  it('reports thrown connection failures', async () => {
    await expect(loadTreasurerDashboard(client({}, 'bank_deposits'), '2026-11-01')).rejects.toThrow('Offline')
  })
  it.each(['service_transactions','service_revenue_summary','service_balances'])('does not turn failed %s into zero revenue', async (table) => {
    await expect(loadServiceRevenue(client({ [table]: error }))).rejects.toThrow('Permission denied')
  })
  it('rejects a missing or malformed summary', async () => {
    await expect(loadServiceRevenue(client({ service_revenue_summary: null }))).rejects.toThrow('incomplete')
    await expect(loadServiceRevenue(client({ service_revenue_summary: { total_collected: 'NaN', collected_this_month: 0, by_service: [] } }))).rejects.toThrow('unavailable')
  })
  it('rejects invalid expense values rather than counting them as zero', async () => {
    await expect(loadTreasurerDashboard(client({ expenses: [{ amount: 'NaN' }] }), '2026-11-01')).rejects.toThrow('Expense amount')
  })
  it('loads more than 500 service receipts without truncation', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `service-${index}`,
      amount_paid: 1,
      payment_status: 'paid',
    }))
    const c = client({ service_transactions: rows })
    const result = await loadServiceRevenue(c)
    expect(result.transactions).toHaveLength(1001)
    expect(c.calls.filter(([table]) => table === 'service_transactions'))
      .toEqual([
        ['service_transactions', 0, 999],
        ['service_transactions', 1000, 1999],
      ])
  })
  it('sums unpaid service balances over multiple API pages', async () => {
    const c = client({ service_balances: Array.from({ length: 1001 }, (_, id) => ({ id, balance_due: '0.10' })) })
    const data = await loadServiceRevenue(c)
    expect(data.totals.owed).toBe(100.1); expect(data.owedIds.size).toBe(1001)
    expect(c.calls.filter(([t]) => t === 'service_balances')).toEqual([['service_balances',0,999],['service_balances',1000,1999]])
  })
})
describe('dated aging', () => {
  const p = [{ id: 1, homeowner_status: 'active', current_balance: '150.00' }]
  const row = { property_id: 1, balance: '150.00', aging_complete: true, is_overdue: true, current_amount: 50, days_1_30_amount: 25, days_31_60_amount: 0, days_61_90_amount: 0, days_90_plus_amount: 75 }
  it('splits one account across source-date buckets', () => {
    expect(summarizeAging(p, [row])).toEqual({ outstanding: 150, overdue: 100, overdueAccounts: 1, aging: { current: 50, days1To30: 25, days31To60: 0, days61To90: 0, days90Plus: 75 } })
  })
  it('does not net advance credits against other homeowner receivables', () => {
    expect(summarizeAging([...p, { id: 2, current_balance: -500 }], [row, { ...row, property_id: 2, balance: 0, is_overdue: false, current_amount: 0, days_1_30_amount: 0, days_90_plus_amount: 0 }]).outstanding).toBe(150)
  })
  it.each([[], [{ ...row, aging_complete: false }], [{ ...row, days_90_plus_amount: null }], [{ ...row, current_amount: 51 }], [{ ...row, balance: 149 }]])('refuses missing, stale or unreconciled aging: %j', (rows) => {
    expect(() => summarizeAging(p, rows)).toThrow()
  })
})
describe('service status filters', () => {
  it.each([40,100])('keeps a voided %s/100 receipt out of paid/outstanding', (paid) => {
    expect(transactionPaymentStatus({ payment_status: 'voided', amount_due: 100, amount_paid: paid }, new Set())).toBe('voided')
  })
  it('recognizes an original partial receipt once its balance is settled', () => {
    expect(transactionPaymentStatus({ id: 'a', payment_status: 'partial' }, new Set())).toBe('paid')
    expect(transactionPaymentStatus({ id: 'a', payment_status: 'partial' }, new Set(['a']))).toBe('outstanding')
  })
})
function writes(result, thrown = false) {
  const calls = []
  const q = { insert(v) { calls.push(['insert',v]); return this }, update(v) { calls.push(['update',v]); return this }, eq() { return this }, neq(k,v) { calls.push(['neq',k,v]); return this }, select() { return this }, async single() { if (thrown) throw new Error('Offline'); return result } }
  return { calls, from: () => q }
}
describe('confirmed and audited expense actions', () => {
  it('accepts the server-confirmed expense', async () => {
    const c = writes({ data: { id: 'e', amount: 50 }, error: null })
    expect((await recordExpense(c, { amount: 50 })).id).toBe('e')
  })
  it.each([NaN, Infinity, 0, -1])('rejects invalid amount %s before sending it', async (amount) => {
    const c = writes({}); await expect(recordExpense(c, { amount })).rejects.toThrow('finite'); expect(c.calls).toEqual([])
  })
  it('sends the required trimmed cancellation reason and rejects already voided rows', async () => {
    const c = writes({ data: { id: 'e', status: 'Voided' }, error: null })
    await voidExpense(c, 'e', '  Wrong amount  ')
    expect(c.calls).toContainEqual(['update', { status: 'Voided', void_reason: 'Wrong amount' }]); expect(c.calls).toContainEqual(['neq','status','Voided'])
  })
  it('rejects a successful-looking cancellation for a different expense', async () => {
    const c = writes({ data: { id: 'different-expense', status: 'Voided' }, error: null })
    await expect(voidExpense(c, 'expected-expense', 'Wrong amount')).rejects.toThrow('could not be confirmed')
  })
  it.each(['','four','x'.repeat(501)])('requires a valid reason', async (reason) => {
    const c = writes({}); await expect(voidExpense(c, 'e', reason)).rejects.toThrow('reason'); expect(c.calls).toEqual([])
  })
  it('does not acknowledge a no-op or failed audit as a saved expense', async () => {
    await expect(recordExpense(writes({ data: null, error: null }), { amount: 10 })).rejects.toThrow('confirmed')
    await expect(recordExpense(writes({ data: null, error: { message: 'Audit unavailable' } }), { amount: 10 })).rejects.toEqual({ message: 'Audit unavailable' })
    await expect(voidExpense(writes({ data: null, error: { message: 'Audit unavailable' } }), 'e', 'Wrong amount')).rejects.toEqual({ message: 'Audit unavailable' })
    await expect(voidExpense(writes({ data: null, error: null }), 'e', 'Wrong amount')).rejects.toThrow('confirmed')
  })
  it('propagates lost connections', async () => {
    await expect(recordExpense(writes({},true), { amount: 10 })).rejects.toThrow('Offline')
    await expect(voidExpense(writes({},true), 'e', 'Wrong amount')).rejects.toThrow('Offline')
  })
})
