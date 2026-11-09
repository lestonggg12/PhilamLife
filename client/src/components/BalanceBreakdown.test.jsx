import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { BalanceItemsTable, BalanceReductionHistory } from './BalanceBreakdown'

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }))

const discount = {
  kind: 'adjustment', ref_id: 'discount', original: -100, unpaid: 0,
  label: 'Staff-entered discount on receipt OR-001', item_date: '2026-11-05',
}

it('shows the original, applied and unpaid amounts without subtracting a recorded discount twice', () => {
  const html = renderToStaticMarkup(<BalanceItemsTable totalDue={100000} items={[
    { kind: 'entry', ref_id: 'old', label: 'Older entered balance', original: 80000, unpaid: 0 },
    { kind: 'entry', ref_id: 'current', label: 'Entered balance', original: 100000, unpaid: 79372.44 },
    { kind: 'entry', ref_id: 'new', label: 'New balance', original: 20000, unpaid: 20000 },
    { kind: 'dues', ref_id: 'dues', label: 'November dues', original: 627.56, unpaid: 627.56 },
    discount,
  ]} />)

  const rows = html.match(/<tr\b[^>]*>.*?<\/tr>/g)
  expect(rows.find((row) => row.includes('₱79,372.44'))).toMatch(/₱100,000\.00.*−₱20,627\.56.*₱79,372\.44/)
  expect(rows.at(-1)).toMatch(/₱200,627\.56.*−₱100,627\.56.*₱100,000\.00/)
  expect(html).not.toContain(discount.label)
})

it('traces receipt numbers using their net balance effect and excludes voided or unrelated payments', () => {
  const html = renderToStaticMarkup(<BalanceReductionHistory adjustments={[discount]} payments={[
    { id: 1, receipt_number: 'OR-001', balance_effect: 400, effect_released: 300, status: 'Completed', payment_date: '2026-11-05' },
    { id: 2, receipt_number: 'OR-NO-EFFECT', balance_effect: 0, status: 'Completed' },
    { id: 3, receipt_number: 'OR-VOIDED', balance_effect: 280, status: 'Voided' },
  ]} />)

  expect(html).toContain('<strong>OR-001</strong>')
  expect(html).toContain(discount.label)
  expect(html.match(/−₱100\.00/g)).toHaveLength(2)
  expect(html).not.toContain('OR-NO-EFFECT')
  expect(html).not.toContain('OR-VOIDED')
})
