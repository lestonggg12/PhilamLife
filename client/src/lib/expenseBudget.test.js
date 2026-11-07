import { describe, expect, it } from 'vitest'
import { budgetComparison, monthlyBudgetCents, isBudgetAmount } from './expenseBudget'
const money = n => `PHP ${(n/100).toFixed(2)}`
const cents = n => Math.round(Number(n)*100)
describe('Admin expense budget allocation and Treasurer comparison', () => {
  it('allocates every centavo exactly once across twelve months', () => {
    const parts = Array.from({length:12}, (_,i) => monthlyBudgetCents('100.01',i+1))
    expect(parts.reduce((a,b)=>a+b,0)).toBe(10001)
    expect(parts[0]).toBe(834)
    expect(parts[11]).toBe(833)
  })
  it('compares monthly actual against one-twelfth of annual allocation', () => {
    const x=budgetComparison([{category:'Insurance',amount:'1500.00'}],
      [{budget_year:2026,category:'Insurance',approved_annual_amount:'18000.00'}],
      '2026-11',cents,money)
    expect(x.rows[0]).toEqual(['Insurance','PHP 1500.00','PHP 1500.00','PHP 0.00'])
    expect(x.complete).toBe(true)
  })
  it('does not invent a missing category budget', () => {
    const x=budgetComparison([{category:'Insurance',amount:'1500.00'}],[],'2026-11',cents,money)
    expect(x.complete).toBe(false)
    expect(x.rows[0]).toEqual(['Insurance','Not recorded','PHP 1500.00','Cannot calculate'])
  })
  it('distinguishes approved zero from not recorded', () => {
    const x=budgetComparison([{category:'Supplies',amount:'200.00'}],
      [{budget_year:2026,category:'Supplies',approved_annual_amount:'0.00'}],
      '2026-11',cents,money)
    expect(x.rows[0][3]).toBe('PHP -200.00')
  })
  it('validates precise monetary inputs and budget year', () => {
    expect(isBudgetAmount('1.234')).toBe(false)
    expect(() => budgetComparison([], [{budget_year:2025,category:'Insurance',approved_annual_amount:'5.00'}], '2026-11',cents,money)).toThrow(/inconsistent/i)
  })
})
