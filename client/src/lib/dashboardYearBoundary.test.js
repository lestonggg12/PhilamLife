import { describe, expect, it } from 'vitest'
import { manilaMonth } from '../hooks/useManilaMonthRollover'
import { secretaryDashboardSummary } from './secretaryDashboardSummary'
import { summarizeTreasurerMonth } from './treasurerFinance'
import { isVerifiedDashboardSnapshot } from './dashboardSnapshot'

const sampleRows = [
  {month_start:'2026-12-01',dues_collected:'125.10',dues_only_collected:'100.00',dues_only_receipts:1},
  {month_start:'2027-01-01',dues_collected:'0.00',dues_only_collected:'0.00',dues_only_receipts:0},
  {month_start:'2027-03-01',dues_collected:'900.00',dues_only_collected:'900.00',dues_only_receipts:1},
]
describe('January 1, 2027 dashboard rollover', () => {
  it('uses the Philippine calendar boundary, not UTC midnight', () => {
    expect(manilaMonth(new Date('2026-12-31T15:59:59Z'))).toBe('2026-12')
    expect(manilaMonth(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01')
  })
  it('does not count 2026 history or future 2027 months in January totals', () => {
    const dec = secretaryDashboardSummary([{current_balance:'200.00'}],sampleRows,{year:'2026',month:'12'})
    const jan = secretaryDashboardSummary([{current_balance:'200.00'}],sampleRows,{year:'2027',month:'01'})
    const mar = secretaryDashboardSummary([{current_balance:'200.00'}],sampleRows,{year:'2027',month:'03'})
    expect(dec.yearlyCollections).toBe(125.10)
    expect(jan.yearlyCollections).toBe(0)
    expect(jan.monthlyCollections).toBe(0)
    expect(jan.outstandingAccounts).toBe(1)
    expect(mar.yearlyCollections).toBe(900)
  })
  it('does not present December financial snapshot as January data', () => {
    const previous={period:'2027-01',verifiedPeriod:'2026-12',loading:false,error:''}
    expect(isVerifiedDashboardSnapshot(previous)).toBe(false)
    expect(isVerifiedDashboardSnapshot({...previous,verifiedPeriod:'2027-01'})).toBe(true)
    expect(isVerifiedDashboardSnapshot({...previous,verifiedPeriod:'2027-01',error:'Offline'})).toBe(false)
    expect(isVerifiedDashboardSnapshot({...previous,verifiedPeriod:'2027-01',loading:true})).toBe(false)
  })
  it('separates January flows from existing receivables and credits', () => {
    const january=summarizeTreasurerMonth(null,[
      {expense_date:'2026-12-31',amount:'300.00',status:'Completed'},
      {expense_date:'2027-01-01',amount:'20.00',status:'Voided'},
      {expense_date:'2027-01-02',amount:'15.10',status:'Completed'},
    ],'2027-01-01')
    expect(january).toEqual({collectedThisMonth:0,servicesThisMonth:0,expensesThisMonth:15.1,netThisMonth:-15.1})
  })
  it('rejects malformed reporting periods',()=>{
    expect(()=>secretaryDashboardSummary([],[],{year:'2027',month:'13'})).toThrow()
  })
})
